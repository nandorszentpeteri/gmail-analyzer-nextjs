import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { google } from 'googleapis'
import { authOptions } from '../auth/[...nextauth]/route'
import {
  createOrUpdateEmails,
  deleteOrphanedEmails,
  updateSyncStatus,
  getSyncStatus,
  createUser,
  createSyncSession,
  updateSyncSession,
  getSyncSession,
  getActiveSyncSession,
  cleanupEmailsInRange,
  getSyncDateRange
} from '@/lib/database'
import { gmailRateLimiter, gmailBatchRateLimiter } from '@/utils/rateLimiter'

interface SyncOptions {
  timeRange: string
  excludeSpam: boolean
  excludeTrash: boolean
  maxEmailSize: number
}

interface EmailData {
  gmailId: string
  threadId?: string
  subject: string
  senderEmail: string
  senderName: string
  toAddress?: string
  date: Date
  size: number
  labels: string[]
  snippet?: string
  hasAttachments: boolean
  attachmentInfo?: any[]
  category?: string
}

class EmailSyncer {
  private gmail: any
  private userEmail: string

  constructor(accessToken: string, userEmail: string) {
    const auth = new google.auth.OAuth2()
    auth.setCredentials({ access_token: accessToken })
    this.gmail = google.gmail({ version: 'v1', auth })
    this.userEmail = userEmail
  }

  async syncEmails(options: SyncOptions) {
    console.log('Starting email sync with options:', options)

    // Calculate sync date range
    const syncRange = getSyncDateRange(options)
    console.log('Sync range:', {
      startDate: syncRange.startDate?.toISOString(),
      endDate: syncRange.endDate.toISOString(),
      timeRange: options.timeRange
    })

    // Create new sync session
    const session = await createSyncSession(this.userEmail, options, syncRange)
    console.log(`Created sync session: ${session.id}`)

    // Mark legacy sync status as in progress (for UI compatibility)
    await updateSyncStatus(this.userEmail, {
      syncInProgress: true,
      syncOptions: options,
      errorMessage: null
    })

    let allProcessedGmailIds: string[] = []

    try {
      // Build Gmail search query
      const query = this.buildSearchQuery(options)
      console.log('Gmail search query:', query)

      // Get all message IDs first
      const messageIds = await this.getAllMessageIds(query)
      console.log(`Found ${messageIds.length} messages to sync`)

      if (messageIds.length === 0) {
        await updateSyncSession(session.id, {
          status: 'completed',
          totalEmails: 0,
          completedAt: new Date()
        })
        await updateSyncStatus(this.userEmail, {
          syncInProgress: false,
          lastSync: new Date(),
          totalEmails: 0
        })
        return { success: true, totalEmails: 0, newEmails: 0, deletedEmails: 0 }
      }

      // Setup batch processing with incremental saving
      const batchSize = 100
      const totalBatches = Math.ceil(messageIds.length / batchSize)
      let totalProcessed = 0

      await updateSyncSession(session.id, {
        totalEmails: messageIds.length,
        totalBatches
      })

      for (let i = 0; i < messageIds.length; i += batchSize) {
        const batch = messageIds.slice(i, i + batchSize)
        const batchNumber = Math.floor(i / batchSize) + 1

        console.log(`🚀 Processing batch ${batchNumber}/${totalBatches} (${batch.length} emails)`)

        try {
          const batchStartTime = Date.now()
          const batchEmails = await this.processBatch(batch, options)
          const batchDuration = (Date.now() - batchStartTime) / 1000

          // Save batch immediately to database (incremental)
          await createOrUpdateEmails(this.userEmail, batchEmails)

          totalProcessed += batchEmails.length
          const batchGmailIds = batchEmails.map(e => e.gmailId)
          allProcessedGmailIds.push(...batchGmailIds)

          console.log(`✅ Batch ${batchNumber} complete: ${batchEmails.length}/${batch.length} emails saved to DB in ${batchDuration.toFixed(1)}s`)

          // Update session progress
          await updateSyncSession(session.id, {
            currentBatch: batchNumber,
            emailsProcessed: totalProcessed
          })

          // Update legacy sync status for UI
          await updateSyncStatus(this.userEmail, {
            syncInProgress: true,
            syncOptions: options,
            totalEmails: totalProcessed
          })

          // Light pause between batches
          if (batchNumber < totalBatches && batchNumber % 3 === 0) {
            console.log(`⏸️  Brief pause after 3 batches...`)
            await this.sleep(1000)
          }

        } catch (batchError) {
          console.error(`❌ Batch ${batchNumber} failed:`, batchError)

          // Mark session as failed but continue with partial data
          await updateSyncSession(session.id, {
            status: 'failed',
            errorMessage: batchError instanceof Error ? batchError.message : 'Batch processing failed',
            emailsProcessed: totalProcessed
          })

          throw batchError
        }
      }

      // All batches completed successfully - now do cleanup
      console.log(`🧹 Cleaning up emails in range...`)
      const deletedResult = await cleanupEmailsInRange(this.userEmail, allProcessedGmailIds, syncRange)
      console.log(`🗑️  Cleaned up ${deletedResult.count} orphaned emails`)

      // Mark session as completed
      await updateSyncSession(session.id, {
        status: 'completed',
        completedAt: new Date()
      })

      // Update legacy sync status
      await updateSyncStatus(this.userEmail, {
        syncInProgress: false,
        lastSync: new Date(),
        totalEmails: totalProcessed,
        errorMessage: null
      })

      console.log('✅ Email sync completed successfully')
      return {
        success: true,
        totalEmails: totalProcessed,
        newEmails: totalProcessed, // Could be refined to track actual new vs updated
        deletedEmails: deletedResult.count,
        sessionId: session.id
      }

    } catch (error) {
      console.error('💥 Email sync error:', error)

      // Mark session as failed
      await updateSyncSession(session.id, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown sync error'
      })

      // Reset legacy sync status
      await updateSyncStatus(this.userEmail, {
        syncInProgress: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown sync error'
      })

      throw error
    }
  }

  private buildSearchQuery(options: SyncOptions): string {
    const parts: string[] = []

    // Time range
    if (options.timeRange !== 'all') {
      parts.push(`newer_than:${options.timeRange}`)
    }

    // Exclude folders
    if (options.excludeSpam) {
      parts.push('-in:spam')
    }
    if (options.excludeTrash) {
      parts.push('-in:trash')
    }

    // Size limit (convert MB to bytes for Gmail query)
    if (options.maxEmailSize > 0) {
      const bytes = options.maxEmailSize * 1024 * 1024
      parts.push(`smaller:${bytes}`)
    }

    return parts.join(' ')
  }

  private async getAllMessageIds(query: string): Promise<string[]> {
    const messageIds: string[] = []
    let pageToken: string | undefined
    let pageCount = 0

    do {
      // Wait for rate limiter before each API call
      await gmailRateLimiter.waitIfNeeded()

      console.log(`📋 Fetching message list page ${pageCount + 1}...`)

      const response = await this.gmail.users.messages.list({
        userId: 'me',
        q: query || undefined,
        maxResults: 500, // Gmail API max
        pageToken
      })

      const messages = response.data.messages || []
      messageIds.push(...messages.map((m: any) => m.id))

      pageToken = response.data.nextPageToken
      pageCount++

      const rateLimitStatus = gmailRateLimiter.getStatus()
      console.log(`📊 Rate limit status: ${rateLimitStatus.requestsInWindow}/${rateLimitStatus.maxRequests} requests in window`)

    } while (pageToken)

    console.log(`✅ Found ${messageIds.length} total messages across ${pageCount} pages`)
    return messageIds
  }

  private async processBatch(messageIds: string[], options: SyncOptions): Promise<EmailData[]> {
    // Controlled parallel processing with 10k/min rate limit
    const concurrency = 10 // Process 10 emails in parallel (balanced approach)
    const results: EmailData[] = []

    // Process in chunks of concurrent requests
    for (let i = 0; i < messageIds.length; i += concurrency) {
      const chunk = messageIds.slice(i, i + concurrency)

      const chunkPromises = chunk.map(async (messageId) => {
        try {
          // Wait for rate limiter before each API call
          await gmailBatchRateLimiter.waitIfNeeded()

          const message = await this.gmail.users.messages.get({
            userId: 'me',
            id: messageId,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'To', 'Date']
          })

          return this.extractEmailData(message.data)
        } catch (error) {
          console.error(`❌ Error processing message ${messageId}:`, error)

          // If it's a rate limit error, wait and retry once
          if (error && typeof error === 'object' && 'code' in error && error.code === 429) {
            console.log('⏱️  Rate limit hit, waiting 30 seconds...')
            await this.sleep(30000) // Wait 30 seconds on quota exceeded

            try {
              await gmailBatchRateLimiter.waitIfNeeded()
              const message = await this.gmail.users.messages.get({
                userId: 'me',
                id: messageId,
                format: 'metadata',
                metadataHeaders: ['Subject', 'From', 'To', 'Date']
              })

              return this.extractEmailData(message.data)
            } catch (retryError) {
              console.error(`❌ Retry failed for message ${messageId}:`, retryError)
              return null
            }
          }
          return null
        }
      })

      const chunkResults = await Promise.all(chunkPromises)
      const validResults = chunkResults.filter((email): email is EmailData => email !== null)
      results.push(...validResults)

      // Log progress and rate limit status
      const rateLimitStatus = gmailBatchRateLimiter.getStatus()
      console.log(`📧 Processed chunk: ${Math.min(i + concurrency, messageIds.length)}/${messageIds.length} | Rate: ${rateLimitStatus.requestsInWindow}/${rateLimitStatus.maxRequests}`)

      // Small pause between chunks to prevent bursting
      if (i + concurrency < messageIds.length) {
        await this.sleep(50) // 50ms pause between chunks
      }
    }

    return results
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private extractEmailData(message: any): EmailData {
    const headers = message.payload?.headers || []
    const getHeader = (name: string) =>
      headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || ''

    const fromField = getHeader('From')
    const senderEmail = this.extractSenderEmail(fromField)
    const senderName = this.extractSenderName(fromField)

    // Parse date with fallback for invalid dates
    const parseDate = (dateString: string): Date => {
      if (!dateString) return new Date() // Fallback to current date if empty

      const parsed = new Date(dateString)
      if (isNaN(parsed.getTime())) {
        console.warn(`Invalid date string "${dateString}" for message ${message.id}, using current date`)
        return new Date() // Fallback to current date if invalid
      }
      return parsed
    }

    // Auto-classify email category
    const category = this.classifyEmail({
      subject: getHeader('Subject'),
      from: fromField,
      senderEmail
    })

    return {
      gmailId: message.id,
      threadId: message.threadId,
      subject: getHeader('Subject'),
      senderEmail,
      senderName,
      toAddress: getHeader('To'),
      date: parseDate(getHeader('Date')),
      size: parseInt(message.sizeEstimate) || 0,
      labels: message.labelIds || [],
      snippet: message.snippet || '',
      hasAttachments: this.hasAttachments(message.payload),
      attachmentInfo: this.getAttachmentInfo(message.payload),
      category
    }
  }

  private extractSenderEmail(fromField: string): string {
    const emailMatch = fromField.match(/<([^>]+)>/) || fromField.match(/([^\s<>]+@[^\s<>]+)/)
    return emailMatch ? emailMatch[1].toLowerCase() : fromField.toLowerCase()
  }

  private extractSenderName(fromField: string): string {
    const nameMatch = fromField.match(/^([^<]+)</) || fromField.match(/^([^@]+)@/)
    return nameMatch ? nameMatch[1].trim().replace(/"/g, '') : fromField.split('@')[0]
  }

  private hasAttachments(payload: any): boolean {
    if (payload?.parts) {
      return payload.parts.some((part: any) =>
        part.filename && part.filename.length > 0 ||
        (part.parts && this.hasAttachments({ parts: part.parts }))
      )
    }
    return false
  }

  private getAttachmentInfo(payload: any): any[] {
    const attachments: any[] = []

    const extractAttachments = (parts: any[]) => {
      if (!parts) return

      parts.forEach(part => {
        if (part.filename && part.filename.length > 0) {
          attachments.push({
            filename: part.filename,
            mimeType: part.mimeType,
            size: parseInt(part.body?.size) || 0
          })
        }
        if (part.parts) {
          extractAttachments(part.parts)
        }
      })
    }

    extractAttachments(payload?.parts)
    return attachments
  }

  private classifyEmail(email: {
    subject: string
    from: string
    senderEmail: string
  }): string {
    const subject = email.subject.toLowerCase()
    const from = email.from.toLowerCase()
    const senderEmail = email.senderEmail.toLowerCase()

    // Only classify emails we're very confident about
    // Let AI handle noreply emails since they could be important (financial, govt, security, etc.)

    // Clear newsletter indicators (explicit marketing)
    if (
      subject.includes('newsletter') ||
      subject.includes('unsubscribe') ||
      from.includes('newsletter') ||
      senderEmail.includes('newsletter') ||
      senderEmail.includes('marketing') ||
      subject.includes('weekly digest') ||
      subject.includes('monthly update')
    ) {
      return 'newsletter'
    }

    // Clear promotional indicators
    if (
      subject.includes('sale') ||
      subject.includes('discount') ||
      subject.includes('offer') ||
      subject.includes('deal') ||
      subject.includes('% off') ||
      subject.includes('free shipping') ||
      subject.includes('limited time') ||
      subject.includes('expires today') ||
      subject.includes('last chance')
    ) {
      return 'promotional'
    }

    // Social media notifications (broader detection - these are rarely important)
    if (
      from.includes('facebook') ||
      from.includes('twitter') ||
      from.includes('linkedin') ||
      from.includes('instagram') ||
      from.includes('tiktok') ||
      from.includes('snapchat') ||
      from.includes('youtube') ||
      from.includes('pinterest') ||
      from.includes('reddit') ||
      senderEmail.includes('facebook.com') ||
      senderEmail.includes('twitter.com') ||
      senderEmail.includes('linkedin.com') ||
      senderEmail.includes('instagram.com') ||
      senderEmail.includes('tiktok.com') ||
      senderEmail.includes('youtube.com')
    ) {
      return 'social'
    }

    // For everything else, including noreply emails, return 'unknown'
    // This will send them to AI analysis where context can be properly evaluated
    return 'unknown'
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.accessToken || !session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in again' }, { status: 401 })
    }

    // Check for token refresh error
    if (session.error === 'RefreshAccessTokenError') {
      console.error('OAuth token refresh failed - user needs to re-authenticate')
      return NextResponse.json({
        error: 'Authentication expired - Please sign out and sign in again',
        requiresReauth: true
      }, { status: 401 })
    }

    const options: SyncOptions = await req.json()

    // Ensure user exists in database
    await createUser(session.user.email, session.user.name, session.user.image)

    // Debug token info
    console.log('Access token length:', session.accessToken.length)
    console.log('Token starts with:', session.accessToken.substring(0, 20))

    // Start sync process
    const syncer = new EmailSyncer(session.accessToken, session.user.email)
    const result = await syncer.syncEmails(options)

    return NextResponse.json(result)

  } catch (error) {
    console.error('Sync API error:', error)

    // Check if it's an authentication or scope error
    if (error instanceof Error && (
      error.message.includes('invalid authentication') ||
      error.message.includes('insufficient authentication scopes') ||
      error.message.includes('OAuth') ||
      error.message.includes('401') ||
      error.message.includes('403')
    )) {
      return NextResponse.json({
        error: 'Gmail authentication failed - Please sign out and sign in again to grant necessary permissions',
        requiresReauth: true,
        details: error.message
      }, { status: 401 })
    }

    return NextResponse.json({
      error: 'Sync failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}