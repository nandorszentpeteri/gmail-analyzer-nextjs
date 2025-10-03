import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { google } from 'googleapis'
import { authOptions } from '../auth/[...nextauth]/route'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import {
  createUser,
  createReport,
  createEmailCandidates,
  createNewsletterSenders,
  getEmailsByUser,
  getSenderFrequencyFromDb,
  getSenderFrequencyGroupedByDomain,
  getSyncStatus
} from '@/lib/database'
import { gmailRateLimiter } from '@/utils/rateLimiter'

// Helper function to convert BigInt values to numbers for JSON serialization
function convertBigIntToNumber(obj: any): any {
  if (obj === null || obj === undefined) return obj

  if (typeof obj === 'bigint') {
    return Number(obj)
  }

  if (Array.isArray(obj)) {
    return obj.map(convertBigIntToNumber)
  }

  if (typeof obj === 'object') {
    const converted: any = {}
    for (const [key, value] of Object.entries(obj)) {
      converted[key] = convertBigIntToNumber(value)
    }
    return converted
  }

  return obj
}

interface AnalysisConfig {
  filterType: string
  query: string
  description: string
  limit: number
  mode: string
  analysisType?: string
}

interface EmailData {
  id: string
  threadId: string
  subject: string
  from: string
  to: string
  date: string
  size: number
  labels: string[]
  snippet: string
  hasAttachments: boolean
  attachmentSizes: Array<{ filename: string; size: number }>
}

class GmailAnalyzer {
  private gmail: any
  private claudeClient: BedrockRuntimeClient
  private userEmail: string

  constructor(accessToken: string, userEmail: string) {
    const auth = new google.auth.OAuth2()
    auth.setCredentials({ access_token: accessToken })

    this.gmail = google.gmail({ version: 'v1', auth })
    this.userEmail = userEmail

    // Configure Bedrock client - let AWS SDK use default credential chain
    const awsRegion = process.env.AWS_REGION || 'us-east-1'
    const awsProfile = process.env.AWS_PROFILE || 'default'

    console.log('Environment check:', {
      AWS_REGION: process.env.AWS_REGION,
      AWS_PROFILE: process.env.AWS_PROFILE,
      NODE_ENV: process.env.NODE_ENV
    })

    // Set the AWS_PROFILE environment variable for the SDK
    if (awsProfile !== 'default') {
      process.env.AWS_PROFILE = awsProfile
    }

    // Use simple configuration like the CLI version
    this.claudeClient = new BedrockRuntimeClient({ region: awsRegion })
  }

  async getMessages(query: string, maxResults: number) {
    console.log(`Fetching messages with query: "${query}", maxResults: ${maxResults}`)

    // Wait for rate limiter
    await gmailRateLimiter.waitIfNeeded()

    // For empty queries, use a basic filter to get recent emails
    const finalQuery = query.trim() || undefined

    console.log(`Final query sent to Gmail: ${finalQuery || '(no query - all emails)'}`)

    const response = await this.gmail.users.messages.list({
      userId: 'me',
      q: finalQuery,
      maxResults: maxResults,
    })

    const messages = response.data.messages || []
    console.log(`Gmail API returned ${messages.length} messages`)

    if (messages.length > 0) {
      console.log('First few message IDs:', messages.slice(0, 3).map(m => m.id))
    } else {
      console.warn('No messages returned from Gmail API')
    }

    return messages
  }

  async getMessage(messageId: string) {
    // Wait for rate limiter
    await gmailRateLimiter.waitIfNeeded()

    const response = await this.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    })

    return response.data
  }

  extractEmailData(message: any): EmailData {
    const headers = message.payload.headers
    const getHeader = (name: string) => headers.find((h: any) => h.name === name)?.value || ''

    return {
      id: message.id,
      threadId: message.threadId,
      subject: getHeader('Subject'),
      from: getHeader('From'),
      to: getHeader('To'),
      date: getHeader('Date'),
      size: parseInt(message.sizeEstimate) || 0,
      labels: message.labelIds || [],
      snippet: message.snippet,
      hasAttachments: this.hasAttachments(message.payload),
      attachmentSizes: this.getAttachmentSizes(message.payload)
    }
  }

  hasAttachments(payload: any): boolean {
    if (payload.parts) {
      return payload.parts.some((part: any) =>
        part.filename && part.filename.length > 0 ||
        (part.parts && this.hasAttachments({ parts: part.parts }))
      )
    }
    return false
  }

  getAttachmentSizes(payload: any): Array<{ filename: string; size: number }> {
    const sizes: Array<{ filename: string; size: number }> = []

    const extractSizes = (parts: any[]) => {
      if (!parts) return

      parts.forEach(part => {
        if (part.filename && part.filename.length > 0 && part.body.size) {
          sizes.push({
            filename: part.filename,
            size: parseInt(part.body.size)
          })
        }
        if (part.parts) {
          extractSizes(part.parts)
        }
      })
    }

    extractSizes(payload.parts)
    return sizes
  }

  async analyzeBatchEmailsWithClaude(emails: EmailData[], mode: string = 'fast') {
    const prompt = this.createBatchAnalysisPrompt(emails, mode)

    const payload = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: Math.min(4000, emails.length * 100), // Scale max tokens with batch size (more efficient per email)
      messages: [{
        role: "user",
        content: prompt
      }]
    }

    const command = new InvokeModelCommand({
      modelId: process.env.CLAUDE_MODEL_ID || 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      body: JSON.stringify(payload),
    })

    try {
      const response = await this.claudeClient.send(command)
      const responseBody = JSON.parse(new TextDecoder().decode(response.body))
      const claudeResponse = responseBody.content[0].text

      // Extract token usage from response
      const tokenUsage = {
        inputTokens: responseBody.usage?.input_tokens || 0,
        outputTokens: responseBody.usage?.output_tokens || 0,
        totalTokens: (responseBody.usage?.input_tokens || 0) + (responseBody.usage?.output_tokens || 0)
      }

      const parsedResults = this.parseBatchAnalysisResult(claudeResponse, emails.length)


      // Distribute token usage across all results
      const tokenUsagePerEmail = {
        inputTokens: Math.round(tokenUsage.inputTokens / emails.length),
        outputTokens: Math.round(tokenUsage.outputTokens / emails.length),
        totalTokens: Math.round(tokenUsage.totalTokens / emails.length)
      }

      return parsedResults.map(result => ({
        ...result,
        tokenUsage: tokenUsagePerEmail
      }))
    } catch (error) {
      console.error('Claude batch analysis error:', error)
      // Return default analysis for all emails
      return emails.map(() => this.getDefaultAnalysis())
    }
  }

  // Progressive analysis with confidence-based follow-up
  async analyzeEmailsProgressively(emails: EmailData[], mode: string = 'fast') {
    console.log(`🧠 Starting progressive analysis for ${emails.length} emails...`)

    // Phase 1: Initial analysis with headers only
    const initialResults = await this.analyzeBatchEmailsWithClaude(emails, mode)

    // Identify low-confidence emails that need more context
    const lowConfidenceEmails: Array<{ email: EmailData; index: number; initialResult: any }> = []
    const finalResults = [...initialResults]

    initialResults.forEach((result, index) => {
      if (result.confidence === 'low') {
        lowConfidenceEmails.push({
          email: emails[index],
          index,
          initialResult: result
        })
      }
    })

    if (lowConfidenceEmails.length === 0) {
      console.log(`✅ All ${emails.length} emails analyzed with high/medium confidence`)
      return finalResults
    }

    console.log(`🔍 Found ${lowConfidenceEmails.length} low-confidence emails, requesting more context...`)

    // Phase 2: Re-analyze low-confidence emails with snippets
    const followUpBatch = lowConfidenceEmails.map(item => item.email)
    const enhancedResults = await this.analyzeEmailsWithSnippets(followUpBatch, mode)

    // Replace low-confidence results with enhanced analysis
    enhancedResults.forEach((enhancedResult, i) => {
      const originalIndex = lowConfidenceEmails[i].index
      finalResults[originalIndex] = {
        ...enhancedResult,
        // Keep original token usage but mark as enhanced
        tokenUsage: {
          ...enhancedResult.tokenUsage,
          followUpRequest: true
        }
      }
    })

    console.log(`✅ Progressive analysis complete: ${emails.length - lowConfidenceEmails.length} initial + ${lowConfidenceEmails.length} enhanced`)
    return finalResults
  }

  // Analyze emails with snippets for better context
  async analyzeEmailsWithSnippets(emails: EmailData[], mode: string = 'fast') {
    const prompt = this.createSnippetAnalysisPrompt(emails, mode)

    const payload = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: Math.min(6000, emails.length * 150), // More tokens for snippet analysis
      messages: [{
        role: "user",
        content: prompt
      }]
    }

    const command = new InvokeModelCommand({
      modelId: process.env.CLAUDE_MODEL_ID || 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      body: JSON.stringify(payload),
    })

    try {
      const response = await this.claudeClient.send(command)
      const responseBody = JSON.parse(new TextDecoder().decode(response.body))
      const claudeResponse = responseBody.content[0].text

      const tokenUsage = {
        inputTokens: responseBody.usage?.input_tokens || 0,
        outputTokens: responseBody.usage?.output_tokens || 0,
        totalTokens: (responseBody.usage?.input_tokens || 0) + (responseBody.usage?.output_tokens || 0)
      }

      const parsedResults = this.parseBatchAnalysisResult(claudeResponse, emails.length)

      const tokenUsagePerEmail = {
        inputTokens: Math.round(tokenUsage.inputTokens / emails.length),
        outputTokens: Math.round(tokenUsage.outputTokens / emails.length),
        totalTokens: Math.round(tokenUsage.totalTokens / emails.length)
      }

      return parsedResults.map(result => ({
        ...result,
        tokenUsage: tokenUsagePerEmail
      }))
    } catch (error) {
      console.error('Claude snippet analysis error:', error)
      return emails.map(() => this.getDefaultAnalysis())
    }
  }

  // Legacy single email method (now uses batch method for consistency)
  async analyzeEmailWithClaude(email: EmailData, mode: string = 'fast') {
    const batchResults = await this.analyzeBatchEmailsWithClaude([email], mode)
    return batchResults[0]
  }

  createSnippetAnalysisPrompt(emails: EmailData[], mode: string) {
    // Include all available data: subject + sender + date + snippet
    const emailsList = emails.map((email, index) => {
      // Convert date to relative format
      const emailDate = new Date(email.date)
      const now = new Date()
      const diffDays = Math.floor((now.getTime() - emailDate.getTime()) / (1000 * 60 * 60 * 24))

      let relativeDate
      if (diffDays < 1) relativeDate = 'today'
      else if (diffDays < 7) relativeDate = `${diffDays}d ago`
      else if (diffDays < 30) relativeDate = `${Math.floor(diffDays/7)}w ago`
      else if (diffDays < 365) relativeDate = `${Math.floor(diffDays/30)}mo ago`
      else relativeDate = `${Math.floor(diffDays/365)}y ago`

      const snippet = email.snippet ? ` | Preview: "${email.snippet}"` : ''
      return `${index + 1}. "${email.subject}" from ${email.from} (${relativeDate})${snippet}`
    }).join('\n')

    const basePrompt = mode === 'fast' || mode === 'auto'
      ? `You are an expert email management assistant. These emails were flagged as uncertain in initial analysis. Use the additional context (email previews) to make confident decisions.

Return JSON array in exact same order:
[{"id": 1, "category": "promotional|newsletter|personal|automated|transactional|spam|social", "cleanupRecommendation": "delete|keep", "reasoning": "Specific reason based on content preview", "confidence": "high|medium|low"}, ...]

ENHANCED ANALYSIS with email previews:
${emailsList}

Use the email previews to determine:
- Is this promotional/marketing content?
- Does it contain personal communication?
- Is it automated notification vs human correspondence?
- Does the content suggest ongoing relevance or expired information?

With preview content available, you should have HIGH confidence for most decisions.`

      : `You are an expert email management consultant. These emails required additional context for proper analysis. Use the email previews to make thorough, confident decisions.

Return JSON array in exact same order:
[{"id": 1, "category": "promotional|newsletter|personal|automated|transactional|spam|social|business", "priority": "high|medium|low", "cleanupRecommendation": "delete|keep", "reasoning": "Detailed analysis based on content preview", "spaceImpact": "high|medium|low", "confidence": "high|medium|low"}, ...]

ENHANCED ANALYSIS with email previews:
${emailsList}

Analyze the preview content for:
- Communication type and sender relationship
- Business vs personal value
- Time sensitivity and current relevance
- Legal, financial, or operational importance
- Content quality and reference value

With email previews, aim for HIGH confidence decisions unless content is truly ambiguous.`

    return basePrompt
  }

  createBatchAnalysisPrompt(emails: EmailData[], mode: string) {
    // Include essential data: subject + sender + date (no snippets or sizes)
    const emailsList = emails.map((email, index) => {
      // Convert date to relative format for efficiency (e.g., "3mo ago", "2d ago")
      const emailDate = new Date(email.date)
      const now = new Date()
      const diffDays = Math.floor((now.getTime() - emailDate.getTime()) / (1000 * 60 * 60 * 24))

      let relativeDate
      if (diffDays < 1) relativeDate = 'today'
      else if (diffDays < 7) relativeDate = `${diffDays}d ago`
      else if (diffDays < 30) relativeDate = `${Math.floor(diffDays/7)}w ago`
      else if (diffDays < 365) relativeDate = `${Math.floor(diffDays/30)}mo ago`
      else relativeDate = `${Math.floor(diffDays/365)}y ago`

      return `${index + 1}. "${email.subject}" from ${email.from} (${relativeDate})`
    }).join('\n')

    if (mode === 'fast' || mode === 'auto') {
      return `You are an expert email management assistant. Analyze these emails for cleanup potential, considering context clues in subjects and sender information.

Return JSON array in exact same order:
[{"id": 1, "category": "promotional|newsletter|personal|automated|transactional|spam|social", "cleanupRecommendation": "delete|keep", "reasoning": "Specific reason for this decision", "confidence": "high|medium|low"}, ...]

Emails to analyze:
${emailsList}

ANALYSIS GUIDELINES:
DELETE when email is:
- Newsletter/marketing content (unsubscribe links, promotional language)
- Social media notifications (mentions, likes, follows)
- Automated system alerts that are no longer relevant
- Spam or suspicious content
- Time-sensitive content that has expired (old deals, events, confirmations)
- Bulk promotional emails from retailers

KEEP when email contains:
- Personal correspondence from individuals
- Important business communications
- Legal, financial, or official documents
- Receipts, confirmations for recent purchases/bookings
- Work-related project discussions
- Account security notifications
- Educational or reference material still relevant

Consider sender patterns, subject line urgency, and temporal relevance. Be decisive but err on the side of caution for unclear cases.

CONFIDENCE LEVELS:
- HIGH: Clear indicators make the decision obvious (e.g., "unsubscribe" in subject, known promotional sender, clear personal email)
- MEDIUM: Good indicators but some uncertainty (e.g., unclear sender, ambiguous subject)
- LOW: Insufficient information to make confident decision - needs more context (email snippet or body)`
    }

    return `You are an expert email management consultant. Perform detailed analysis of these emails for inbox cleanup, considering business value, personal importance, and temporal relevance.

Return JSON array in exact same order:
[{"id": 1, "category": "promotional|newsletter|personal|automated|transactional|spam|social|business", "priority": "high|medium|low", "cleanupRecommendation": "delete|keep", "reasoning": "Detailed explanation with specific rationale", "spaceImpact": "high|medium|low", "confidence": "high|medium|low"}, ...]

Emails to analyze:
${emailsList}

DETAILED ANALYSIS CRITERIA:

DELETE (be aggressive on cleanup):
- Marketing emails and newsletters (even from known brands)
- Social media notifications (likes, follows, comments, updates)
- Expired promotions, deals, and time-sensitive offers
- Old shipping/delivery notifications (>30 days)
- Automated system alerts that are outdated
- Welcome emails and onboarding sequences
- Event notifications for past events
- Password reset emails that have been used
- Promotional emails from online retailers
- Subscription confirmation emails (once subscribed)

KEEP (preserve important content):
- Personal emails from family, friends, colleagues
- Business correspondence with ongoing relevance
- Legal documents, contracts, and agreements
- Financial statements, receipts, and tax documents
- Work-related project communications
- Account security alerts and important notifications
- Educational content with lasting value
- Travel confirmations for future/recent trips
- Medical and healthcare communications
- Government and official institution correspondence

ANALYSIS FACTORS:
- Sender authority and relationship to user
- Subject line urgency and content type
- Temporal relevance (recent vs outdated)
- Potential future reference value
- Business vs personal importance
- Legal or financial significance

Provide specific reasoning that explains WHY each email should be kept or deleted based on these factors.

CONFIDENCE LEVELS:
- HIGH: Multiple clear indicators support the decision with high certainty
- MEDIUM: Some indicators present but decision could benefit from additional context
- LOW: Insufficient information from headers alone - requires email content to make proper decision`
  }

  // Legacy method for single email (kept for compatibility)
  createAnalysisPrompt(email: EmailData, mode: string) {
    return this.createBatchAnalysisPrompt([email], mode)
  }

  parseBatchAnalysisResult(response: string, expectedCount: number) {
    try {
      const cleanResponse = response.replace(/```json\n?|\n?```/g, '').trim()
      const parsed = JSON.parse(cleanResponse)

      if (Array.isArray(parsed)) {
        // Map results back to expected format, handling missing or extra results
        const results = []
        for (let i = 0; i < expectedCount; i++) {
          const result = parsed.find(r => r.id === i + 1) || parsed[i]
          if (result) {
            // Remove the id field and return clean result
            const { id, ...cleanResult } = result
            results.push(cleanResult)
          } else {
            results.push(this.getDefaultAnalysis())
          }
        }
        return results
      } else {
        // Single result returned, replicate for all emails
        return Array(expectedCount).fill(parsed)
      }
    } catch (error) {
      console.error('Batch analysis parsing error:', error)
      // Return default analysis for all emails
      return Array(expectedCount).fill(this.getDefaultAnalysis())
    }
  }

  parseAnalysisResult(response: string) {
    try {
      const cleanResponse = response.replace(/```json\n?|\n?```/g, '').trim()
      return JSON.parse(cleanResponse)
    } catch (error) {
      return this.getDefaultAnalysis()
    }
  }

  getDefaultAnalysis() {
    // Conservative default when AI analysis fails
    return {
      category: 'unknown',
      priority: 'low',
      cleanupRecommendation: 'keep',
      reasoning: 'Analysis failed - keeping for safety until manual review',
      spaceImpact: 'low',
      confidence: 'low'
    }
  }

  async runSenderFrequencyAnalysis(config: AnalysisConfig) {
    console.log('Starting sender frequency analysis with config:', config)

    // Check if we have synced data available
    const syncStatus = await getSyncStatus(this.userEmail)
    const hasSyncedData = syncStatus && syncStatus.totalEmails > 0

    if (hasSyncedData) {
      console.log('🚀 Using synced data for ultra-fast sender frequency analysis!')
      return this.runSenderFrequencyFromDatabase(config)
    } else {
      console.log('📧 No synced data available, using Gmail API (consider syncing first for better performance)')
      return this.runSenderFrequencyFromGmail(config)
    }
  }

  async runSenderFrequencyFromDatabase(config: AnalysisConfig) {
    console.log('🗄️ Running sender frequency analysis from local database...')

    // Extract time range from query or use 'all'
    const timeRange = this.extractTimeRangeFromQuery(config.query) || 'all'

    // Get domain-grouped sender frequency data from database
    const domainGroupedData = await getSenderFrequencyGroupedByDomain(this.userEmail, {
      timeRange,
      limit: config.limit
    })

    console.log(`✅ Database analysis complete! Found ${domainGroupedData.length} domains`)

    // Flatten for backward compatibility with existing UI, but add domain info
    const formattedSenders = []
    let rank = 1

    for (const domainGroup of domainGroupedData) {
      for (const sender of domainGroup.senders) {
        formattedSenders.push({
          rank: rank++,
          senderEmail: sender.senderEmail,
          senderName: sender.senderName,
          count: sender.count,
          totalSize: sender.totalSize,
          percentage: 0, // Will calculate after we have total
          avgEmailSize: Math.round(sender.totalSize / sender.count),
          latestDate: sender.latestDate,
          categories: [sender.category],
          category: sender.category,
          domain: domainGroup.domain,
          domainStats: domainGroup.domainStats
        })
      }
    }

    const totalEmails = formattedSenders.reduce((sum, s) => sum + s.count, 0)
    const totalSize = formattedSenders.reduce((sum, s) => sum + s.totalSize, 0)

    // Update percentages now that we have total
    formattedSenders.forEach(sender => {
      sender.percentage = Math.round((sender.count / totalEmails) * 100 * 10) / 10
    })

    return {
      summary: {
        totalEmails,
        uniqueSenders: formattedSenders.length,
        uniqueDomains: domainGroupedData.length,
        topSendersCount: Math.min(10, formattedSenders.length),
        topSendersEmails: formattedSenders.slice(0, 10).reduce((sum, s) => sum + s.count, 0),
        totalSize,
        analysisType: 'sender_frequency'
      },
      senderFrequency: formattedSenders,
      domainGroups: domainGroupedData,
      config,
      createdAt: new Date().toISOString()
    }
  }

  async runSenderFrequencyFromGmail(config: AnalysisConfig) {

    // Test Gmail access
    try {
      console.log('Testing Gmail API access...')
      const testMessages = await this.getMessages('', 5)
      console.log(`Gmail API test successful: found ${testMessages.length} emails`)
    } catch (error) {
      console.error('Gmail API test failed:', error)
      throw new Error('Gmail API access failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }

    console.log('Fetching emails for sender analysis...')
    const messageList = await this.getMessages(config.query, config.limit)

    if (!messageList || messageList.length === 0) {
      throw new Error(`No emails found matching the criteria. Query: "${config.query}"`)
    }

    console.log(`Found ${messageList.length} emails, analyzing sender frequency...`)

    const senderStats = new Map<string, {
      email: string
      name: string
      count: number
      totalSize: number
      latestDate: string
      categories: Set<string>
    }>()

    const batchSize = 10
    for (let i = 0; i < messageList.length; i += batchSize) {
      const batch = messageList.slice(i, i + batchSize)

      const batchPromises = batch.map(async (msg: any, index: number) => {
        try {
          console.log(`📧 Processing email ${i + index + 1}/${messageList.length}...`)

          const message = await this.getMessage(msg.id)
          const emailData = this.extractEmailData(message)

          const senderEmail = this.extractSenderEmail(emailData.from)
          const senderName = this.extractSenderName(emailData.from)

          // Simple category classification based on email patterns (no AI needed!)
          const category = this.classifyEmailCategory(emailData)

          if (senderStats.has(senderEmail)) {
            const existing = senderStats.get(senderEmail)!
            existing.count++
            existing.totalSize += emailData.size
            existing.categories.add(category)

            // Keep the latest date
            if (new Date(emailData.date) > new Date(existing.latestDate)) {
              existing.latestDate = emailData.date
            }
          } else {
            senderStats.set(senderEmail, {
              email: senderEmail,
              name: senderName,
              count: 1,
              totalSize: emailData.size,
              latestDate: emailData.date,
              categories: new Set([category])
            })
          }

          console.log(`✅ [${i + index + 1}] Processed: ${senderEmail} (${senderName}) - ${category}`)

          return true
        } catch (error) {
          console.error(`❌ Error processing email ${msg.id}:`, error)
          return false
        }
      })

      await Promise.all(batchPromises)
      console.log(`📊 Completed batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(messageList.length/batchSize)}`)
    }

    // Convert to array and sort by count (most frequent first)
    const sortedSenders = Array.from(senderStats.values())
      .map(sender => ({
        ...sender,
        categories: Array.from(sender.categories)
      }))
      .sort((a, b) => b.count - a.count)

    console.log(`\n🎯 SENDER FREQUENCY ANALYSIS COMPLETE! (No AI used - pure email header analysis)`)
    console.log(`📧 Total emails processed: ${messageList.length}`)
    console.log(`👥 Unique senders found: ${sortedSenders.length}`)
    console.log(`🏆 Top sender: ${sortedSenders[0]?.name} (${sortedSenders[0]?.count} emails)`)
    console.log(`⚡ Analysis was ${messageList.length * 10}x faster by skipping AI processing!`)

    return this.generateSenderFrequencyReport(sortedSenders, messageList.length, config)
  }

  generateSenderFrequencyReport(senders: any[], totalEmails: number, config: AnalysisConfig, tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number; requestCount: number }) {
    // Calculate some summary stats
    const totalSize = senders.reduce((sum, sender) => sum + sender.totalSize, 0)
    const topSendersCount = Math.min(10, senders.length)
    const topSendersEmails = senders.slice(0, topSendersCount).reduce((sum, sender) => sum + sender.count, 0)

    const report: any = {
      summary: {
        totalEmails,
        uniqueSenders: senders.length,
        topSendersCount,
        topSendersEmails,
        totalSize,
        analysisType: 'sender_frequency'
      },
      senderFrequency: senders.map((sender, index) => ({
        rank: index + 1,
        senderEmail: sender.email,
        senderName: sender.name,
        count: sender.count,
        totalSize: sender.totalSize,
        percentage: Math.round((sender.count / totalEmails) * 100 * 10) / 10,
        avgEmailSize: Math.round(sender.totalSize / sender.count),
        latestDate: sender.latestDate,
        categories: sender.categories,
        category: sender.categories[0] || 'unknown' // Primary category for compatibility
      })),
      config,
      createdAt: new Date().toISOString()
    }

    // Add token usage information if provided (though sender frequency usually doesn't use AI)
    if (tokenUsage) {
      report.tokenUsage = tokenUsage
    }

    return report
  }

  async runFullAnalysis(config: AnalysisConfig) {
    console.log('Starting runFullAnalysis with config:', config)

    // Check if this is a sender frequency analysis
    if (config.analysisType === 'sender_frequency') {
      return this.runSenderFrequencyAnalysis(config)
    }

    // Check if we have synced data for cleanup analysis optimization
    const syncStatus = await getSyncStatus(this.userEmail)
    const hasSyncedData = syncStatus && syncStatus.totalEmails > 0

    if (hasSyncedData) {
      console.log('🚀 Using hybrid approach: pre-filtering with synced data + AI for uncertain emails')
      return this.runHybridCleanupAnalysis(config)
    } else {
      console.log('📧 No synced data available, using traditional Gmail API approach')
      return this.runTraditionalCleanupAnalysis(config)
    }
  }

  async runHybridCleanupAnalysis(config: AnalysisConfig) {
    console.log('🔄 Running hybrid cleanup analysis using synced data + selective AI...')

    // Get emails from database with filters applied
    const timeRange = this.extractTimeRangeFromQuery(config.query) || 'all'
    const emails = await getEmailsByUser(this.userEmail, {
      timeRange,
      limit: config.limit
    })

    if (emails.length === 0) {
      throw new Error('No emails found in synced data matching the criteria')
    }

    console.log(`📊 Found ${emails.length} emails in database, starting hybrid analysis...`)

    // Separate emails into those that need AI analysis vs those we can classify locally
    const needsAI: any[] = []
    const preClassified: any[] = []

    emails.forEach(email => {
      // If we already have a reliable category or can classify with high confidence
      if (this.canClassifyWithoutAI(email)) {
        const analysis = this.getLocalAnalysis(email)
        preClassified.push({
          emailId: email.gmailId,
          ...analysis,
          originalEmail: this.convertDbEmailToEmailData(email)
        })
      } else {
        needsAI.push(email)
      }
    })

    console.log(`📈 Pre-classified ${preClassified.length} emails locally, ${needsAI.length} need AI analysis`)

    // Track token usage across all AI requests
    let totalTokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      requestCount: 0
    }

    // Only run AI analysis on uncertain emails using batch processing
    const aiAnalyses = []
    if (needsAI.length > 0) {
      const batchSize = 15 // Process 15 emails per AI request (sweet spot for cost/performance)
      for (let i = 0; i < needsAI.length; i += batchSize) {
        const batch = needsAI.slice(i, i + batchSize)

        try {
          console.log(`🤖 AI Batch [${Math.floor(i/batchSize) + 1}/${Math.ceil(needsAI.length/batchSize)}]: Analyzing ${batch.length} emails...`)

          // Convert batch to EmailData format
          const emailDataBatch = batch.map(email => this.convertDbEmailToEmailData(email))

          // Analyze with progressive analysis if auto mode, otherwise use standard batch
          const batchResults = config.mode === 'auto'
            ? await this.analyzeEmailsProgressively(emailDataBatch, config.mode)
            : await this.analyzeBatchEmailsWithClaude(emailDataBatch, config.mode)

          // Aggregate token usage from batch
          if (batchResults.length > 0 && batchResults[0].tokenUsage) {
            // Multiply by batch size since we distributed tokens across emails
            const batchTokenUsage = batchResults[0].tokenUsage
            totalTokenUsage.inputTokens += batchTokenUsage.inputTokens * batchResults.length
            totalTokenUsage.outputTokens += batchTokenUsage.outputTokens * batchResults.length
            totalTokenUsage.totalTokens += batchTokenUsage.totalTokens * batchResults.length
            totalTokenUsage.requestCount++
          }

          // Process batch results
          batch.forEach((email, index) => {
            const analysis = batchResults[index]
            if (analysis) {
              console.log(`✅ AI [${i + index + 1}/${needsAI.length}] ${analysis.cleanupRecommendation.toUpperCase()}: "${email.subject}"`)

              aiAnalyses.push({
                emailId: email.gmailId,
                ...analysis,
                originalEmail: emailDataBatch[index]
              })
            }
          })

        } catch (error) {
          console.error(`❌ Batch AI analysis failed for batch ${Math.floor(i/batchSize) + 1}:`, error)

          // Fallback to individual analysis for this batch
          for (let j = 0; j < batch.length; j++) {
            const email = batch[j]
            try {
              const emailData = this.convertDbEmailToEmailData(email)
              const analysis = await this.analyzeEmailWithClaude(emailData, config.mode)

              if (analysis.tokenUsage) {
                totalTokenUsage.inputTokens += analysis.tokenUsage.inputTokens
                totalTokenUsage.outputTokens += analysis.tokenUsage.outputTokens
                totalTokenUsage.totalTokens += analysis.tokenUsage.totalTokens
                totalTokenUsage.requestCount++
              }

              aiAnalyses.push({
                emailId: email.gmailId,
                ...analysis,
                originalEmail: emailData
              })
            } catch (individualError) {
              console.error(`❌ Individual fallback failed for email ${email.gmailId}:`, individualError)
            }
          }
        }
      }
    }

    // Combine all analyses
    const allAnalyses = [...preClassified, ...aiAnalyses]

    console.log(`✅ Hybrid analysis complete! ${preClassified.length} local + ${aiAnalyses.length} AI = ${allAnalyses.length} total`)
    console.log(`🪙 Token usage: ${totalTokenUsage.totalTokens} tokens across ${totalTokenUsage.requestCount} AI requests`)

    return this.generateReport(allAnalyses, config, totalTokenUsage)
  }

  private canClassifyWithoutAI(email: any): boolean {
    const subject = email.subject.toLowerCase()
    const senderEmail = email.senderEmail.toLowerCase()

    // Only classify very obvious cases without AI
    // Send noreply emails to AI since they could be important (financial, govt, security)
    return (
      // Obvious newsletters (explicit marketing)
      (subject.includes('newsletter') && subject.includes('unsubscribe')) ||
      senderEmail.includes('newsletter') ||
      senderEmail.includes('marketing') ||

      // Very clear promotional emails
      (subject.includes('sale') && subject.includes('% off')) ||
      subject.includes('limited time offer') ||
      subject.includes('expires today')
    )
  }

  private getLocalAnalysis(email: any) {
    const subject = email.subject.toLowerCase()
    const senderEmail = email.senderEmail.toLowerCase()

    // Only handle very obvious cases

    // Explicit newsletter with unsubscribe -> delete
    if ((subject.includes('newsletter') && subject.includes('unsubscribe')) || senderEmail.includes('newsletter')) {
      return {
        category: 'newsletter',
        cleanupRecommendation: 'delete',
        reasoning: 'Explicit newsletter with unsubscribe link - safe to delete'
      }
    }

    // Very obvious promotional -> delete
    if ((subject.includes('sale') && subject.includes('% off')) || subject.includes('limited time offer')) {
      return {
        category: 'promotional',
        cleanupRecommendation: 'delete',
        reasoning: 'Clear promotional offer - likely expired'
      }
    }

    // Marketing emails -> delete
    if (senderEmail.includes('marketing')) {
      return {
        category: 'promotional',
        cleanupRecommendation: 'delete',
        reasoning: 'From marketing sender - promotional content'
      }
    }

    // Default - should not reach here often with updated canClassifyWithoutAI
    return {
      category: 'unknown',
      cleanupRecommendation: 'keep',
      reasoning: 'Unclear classification - keeping for safety'
    }
  }

  private convertDbEmailToEmailData(dbEmail: any): EmailData {
    return {
      id: dbEmail.gmailId,
      threadId: dbEmail.threadId,
      subject: dbEmail.subject,
      from: `${dbEmail.senderName} <${dbEmail.senderEmail}>`,
      to: dbEmail.toAddress || '',
      date: dbEmail.date.toISOString(),
      size: dbEmail.size,
      labels: JSON.parse(dbEmail.labels || '[]'),
      snippet: dbEmail.snippet || '',
      hasAttachments: dbEmail.hasAttachments,
      attachmentSizes: JSON.parse(dbEmail.attachmentInfo || '[]')
    }
  }

  async runTraditionalCleanupAnalysis(config: AnalysisConfig) {

    // First test Gmail access with a simple query
    try {
      console.log('Testing Gmail API access...')
      const testMessages = await this.getMessages('', 5) // Get any 5 emails
      console.log(`Gmail API test successful: found ${testMessages.length} emails`)
    } catch (error) {
      console.error('Gmail API test failed:', error)
      throw new Error('Gmail API access failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }

    console.log('Fetching emails with user query...')
    const messageList = await this.getMessages(config.query, config.limit)

    if (!messageList || messageList.length === 0) {
      console.error('No emails found matching the criteria')
      console.log('Query used:', config.query)
      console.log('Limit:', config.limit)
      throw new Error(`No emails found matching the criteria. Query: "${config.query}"`)
    }

    console.log(`Found ${messageList.length} emails, starting analysis...`)

    // Track token usage across all AI requests
    let totalTokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      requestCount: 0
    }

    const analyses = []
    const fetchBatchSize = 10 // Fetch emails in batches
    const aiBatchSize = 15 // Analyze emails in AI batches (sweet spot for cost/performance)

    // First, fetch all email data
    const allEmailData = []
    for (let i = 0; i < messageList.length; i += fetchBatchSize) {
      const batch = messageList.slice(i, i + fetchBatchSize)

      const batchPromises = batch.map(async (msg: any, index: number) => {
        try {
          console.log(`📧 Fetching email ${i + index + 1}/${messageList.length}: ${msg.id}`)

          const message = await this.getMessage(msg.id)
          const emailData = this.extractEmailData(message)

          console.log(`📧 [${i + index + 1}] Subject: "${emailData.subject}" | From: ${emailData.from} | Size: ${Math.round(emailData.size/1024)}KB`)

          return emailData
        } catch (error) {
          console.error(`❌ Error fetching email ${msg.id}:`, error)
          return null
        }
      })

      const batchResults = await Promise.all(batchPromises)
      allEmailData.push(...batchResults.filter(result => result !== null))

      console.log(`📧 Completed fetch batch ${Math.floor(i/fetchBatchSize) + 1}/${Math.ceil(messageList.length/fetchBatchSize)}`)
    }

    // Now analyze in AI batches
    for (let i = 0; i < allEmailData.length; i += aiBatchSize) {
      const batch = allEmailData.slice(i, i + aiBatchSize)

      try {
        console.log(`🤖 AI Batch [${Math.floor(i/aiBatchSize) + 1}/${Math.ceil(allEmailData.length/aiBatchSize)}]: Analyzing ${batch.length} emails...`)

        // Analyze with progressive analysis if auto mode, otherwise use standard batch
        const batchResults = config.mode === 'auto'
          ? await this.analyzeEmailsProgressively(batch, config.mode)
          : await this.analyzeBatchEmailsWithClaude(batch, config.mode)

        // Aggregate token usage from batch
        if (batchResults.length > 0 && batchResults[0].tokenUsage) {
          // Multiply by batch size since we distributed tokens across emails
          const batchTokenUsage = batchResults[0].tokenUsage
          totalTokenUsage.inputTokens += batchTokenUsage.inputTokens * batchResults.length
          totalTokenUsage.outputTokens += batchTokenUsage.outputTokens * batchResults.length
          totalTokenUsage.totalTokens += batchTokenUsage.totalTokens * batchResults.length
          totalTokenUsage.requestCount++
        }

        // Process batch results
        batch.forEach((emailData, index) => {
          const analysis = batchResults[index]
          if (analysis) {
            console.log(`✅ [${i + index + 1}/${allEmailData.length}] Analysis: ${analysis.cleanupRecommendation.toUpperCase()} | Category: ${analysis.category} | Reason: ${analysis.reasoning}`)

            analyses.push({
              emailId: emailData.id,
              ...analysis,
              originalEmail: emailData
            })
          }
        })

      } catch (error) {
        console.error(`❌ Batch AI analysis failed for batch ${Math.floor(i/aiBatchSize) + 1}:`, error)

        // Fallback to individual analysis for this batch
        for (let j = 0; j < batch.length; j++) {
          const emailData = batch[j]
          try {
            const analysis = await this.analyzeEmailWithClaude(emailData, config.mode)

            if (analysis.tokenUsage) {
              totalTokenUsage.inputTokens += analysis.tokenUsage.inputTokens
              totalTokenUsage.outputTokens += analysis.tokenUsage.outputTokens
              totalTokenUsage.totalTokens += analysis.tokenUsage.totalTokens
              totalTokenUsage.requestCount++
            }

            analyses.push({
              emailId: emailData.id,
              ...analysis,
              originalEmail: emailData
            })
          } catch (individualError) {
            console.error(`❌ Individual fallback failed for email ${emailData.id}:`, individualError)
          }
        }
      }
    }

    console.log('\n🎯 ANALYSIS COMPLETE! Summary:')
    const summary = {
      total: analyses.length,
      delete: analyses.filter(a => a.cleanupRecommendation === 'delete').length,
      archive: analyses.filter(a => a.cleanupRecommendation === 'archive').length,
      keep: analyses.filter(a => a.cleanupRecommendation === 'keep').length
    }
    console.log(`📧 Total processed: ${summary.total}`)
    console.log(`🗑️  DELETE recommendations: ${summary.delete}`)
    console.log(`📦 ARCHIVE recommendations: ${summary.archive}`)
    console.log(`✅ KEEP recommendations: ${summary.keep}`)
    console.log(`🪙 Token usage: ${totalTokenUsage.totalTokens} tokens across ${totalTokenUsage.requestCount} AI requests`)

    return this.generateReport(analyses, config, totalTokenUsage)
  }

  generateReport(analyses: any[], config: AnalysisConfig, tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number; requestCount: number }) {
    const deletionCandidates: any[] = []
    const keepCandidates: any[] = []
    const newsletterSenders = new Map()

    let totalSize = 0
    let potentialSavings = 0

    analyses.forEach(analysis => {
      const email = analysis.originalEmail
      totalSize += email.size

      // Include both delete and archive recommendations as deletion candidates
      if (analysis.cleanupRecommendation === 'delete' || analysis.cleanupRecommendation === 'archive') {
        potentialSavings += email.size
        deletionCandidates.push({
          id: email.id,
          subject: email.subject,
          from: email.from,
          date: email.date,
          size: email.size,
          category: analysis.category,
          reasoning: analysis.reasoning,
          confidence: analysis.confidence
        })
      } else if (analysis.cleanupRecommendation === 'keep') {
        // Track emails recommended to keep
        keepCandidates.push({
          id: email.id,
          subject: email.subject,
          from: email.from,
          date: email.date,
          size: email.size,
          category: analysis.category,
          reasoning: analysis.reasoning,
          confidence: analysis.confidence
        })
      }

      // Track newsletter senders
      if (analysis.category === 'newsletter' || analysis.category === 'promotional') {
        const senderEmail = this.extractSenderEmail(email.from)
        if (newsletterSenders.has(senderEmail)) {
          const existing = newsletterSenders.get(senderEmail)
          existing.count++
          existing.totalSize += email.size
        } else {
          newsletterSenders.set(senderEmail, {
            senderEmail,
            senderName: this.extractSenderName(email.from),
            count: 1,
            totalSize: email.size,
            category: analysis.category
          })
        }
      }
    })

    // Sort by date (newest first) instead of size
    deletionCandidates.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    keepCandidates.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    const report: any = {
      summary: {
        totalEmails: analyses.length,
        deletionCandidates: deletionCandidates.length,
        keepCandidates: keepCandidates.length,
        newsletterSenders: newsletterSenders.size,
        totalSize,
        potentialSavings
      },
      deletionCandidates,
      keepCandidates,
      newsletterSenders: Array.from(newsletterSenders.values()).sort((a, b) => b.count - a.count),
      config,
      createdAt: new Date().toISOString()
    }

    // Add token usage information if provided
    if (tokenUsage) {
      report.tokenUsage = tokenUsage
    }

    return report
  }

  extractSenderEmail(fromField: string): string {
    const emailMatch = fromField.match(/<([^>]+)>/) || fromField.match(/([^\s<>]+@[^\s<>]+)/)
    return emailMatch ? emailMatch[1].toLowerCase() : fromField.toLowerCase()
  }

  extractSenderName(fromField: string): string {
    const nameMatch = fromField.match(/^([^<]+)</) || fromField.match(/^([^@]+)@/)
    return nameMatch ? nameMatch[1].trim().replace(/"/g, '') : fromField.split('@')[0]
  }

  // Simple email categorization without AI (much faster!)
  classifyEmailCategory(email: EmailData): string {
    const subject = email.subject.toLowerCase()
    const from = email.from.toLowerCase()
    const senderEmail = this.extractSenderEmail(email.from).toLowerCase()

    // Only classify very obvious cases
    // Let AI handle noreply emails since they could be important

    // Clear newsletter indicators
    if (
      subject.includes('newsletter') ||
      subject.includes('unsubscribe') ||
      from.includes('newsletter') ||
      senderEmail.includes('newsletter') ||
      senderEmail.includes('marketing')
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
      from.includes('deals') ||
      from.includes('offers') ||
      from.includes('sales')
    ) {
      return 'promotional'
    }

    // Social media indicators (broader - these are rarely important)
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
      senderEmail.includes('youtube.com') ||
      subject.includes('mentioned you') ||
      subject.includes('tagged you') ||
      subject.includes('liked your') ||
      subject.includes('followed you')
    ) {
      return 'social'
    }

    // For noreply and other uncertain cases, return 'unknown'
    // This will be handled more intelligently by AI analysis
    return 'unknown'
  }

  private extractTimeRangeFromQuery(query: string): string {
    if (!query) return 'all'

    if (query.includes('newer_than:7d')) return '7d'
    if (query.includes('newer_than:30d')) return '30d'
    if (query.includes('newer_than:3m')) return '3m'
    if (query.includes('newer_than:6m')) return '6m'
    if (query.includes('newer_than:1y')) return '1y'

    return 'all'
  }
}

// Save report to database
async function saveReportToDatabase(report: any, userEmail: string) {
  // Create user if doesn't exist
  await createUser(userEmail)

  // Handle sender frequency analysis differently
  if (report.summary.analysisType === 'sender_frequency') {
    // Create report for sender frequency analysis
    const dbReport = await createReport({
      userEmail,
      description: report.config.description,
      mode: report.config.mode,
      limit: report.config.limit,
      totalEmails: report.summary.totalEmails,
      deletionCandidates: 0, // No deletion candidates in sender frequency analysis
      newsletterSenders: report.summary.uniqueSenders,
      totalSize: BigInt(report.summary.totalSize || 0),
      potentialSavings: BigInt(0), // No potential savings calculation
      tokenInputCount: report.tokenUsage?.inputTokens || 0,
      tokenOutputCount: report.tokenUsage?.outputTokens || 0,
      tokenTotalCount: report.tokenUsage?.totalTokens || 0,
      aiRequestCount: report.tokenUsage?.requestCount || 0
    })

    // Store sender frequency data as newsletter senders (reusing the table structure)
    if (report.senderFrequency?.length > 0) {
      await createNewsletterSenders(
        dbReport.id,
        report.senderFrequency.map((sender: any) => ({
          senderEmail: sender.senderEmail,
          senderName: sender.senderName,
          count: sender.count,
          totalSize: BigInt(sender.totalSize),
          category: sender.category
        }))
      )
    }

    return dbReport
  }

  // Original cleanup analysis logic
  const dbReport = await createReport({
    userEmail,
    description: report.config.description,
    mode: report.config.mode,
    limit: report.config.limit,
    totalEmails: report.summary.totalEmails,
    deletionCandidates: report.summary.deletionCandidates,
    keepCandidates: report.summary.keepCandidates || 0,
    newsletterSenders: report.summary.newsletterSenders,
    totalSize: BigInt(report.summary.totalSize || 0),
    potentialSavings: BigInt(report.summary.potentialSavings || 0),
    tokenInputCount: report.tokenUsage?.inputTokens || 0,
    tokenOutputCount: report.tokenUsage?.outputTokens || 0,
    tokenTotalCount: report.tokenUsage?.totalTokens || 0,
    aiRequestCount: report.tokenUsage?.requestCount || 0
  })

  // Create deletion candidates if they exist
  if (report.deletionCandidates?.length > 0) {

    await createEmailCandidates(
      dbReport.id,
      report.deletionCandidates.map((email: any) => ({
        emailId: email.id,
        subject: email.subject,
        from: email.from,
        date: email.date,
        size: BigInt(email.size),
        category: email.category,
        reasoning: email.reasoning,
        recommendationType: 'delete',
        confidence: email.confidence
      }))
    )
  }

  // Create keep candidates if they exist
  if (report.keepCandidates?.length > 0) {
    await createEmailCandidates(
      dbReport.id,
      report.keepCandidates.map((email: any) => ({
        emailId: email.id,
        subject: email.subject,
        from: email.from,
        date: email.date,
        size: BigInt(email.size),
        category: email.category,
        reasoning: email.reasoning,
        recommendationType: 'keep',
        confidence: email.confidence
      }))
    )
  }

  // Create newsletter senders if they exist
  if (report.newsletterSenders?.length > 0) {
    await createNewsletterSenders(
      dbReport.id,
      report.newsletterSenders.map((sender: any) => ({
        senderEmail: sender.senderEmail,
        senderName: sender.senderName,
        count: sender.count,
        totalSize: BigInt(sender.totalSize),
        category: sender.category
      }))
    )
  }

  return dbReport
}

export async function POST(req: NextRequest) {
  try {
    console.log('Starting analysis API call...')

    const session = await getServerSession(authOptions)
    console.log('Session status:', { hasSession: !!session, hasAccessToken: !!session?.accessToken })

    if (!session?.accessToken) {
      console.error('No access token in session')
      return NextResponse.json({ error: 'Unauthorized - Please sign in again' }, { status: 401 })
    }

    const config: AnalysisConfig = await req.json()
    console.log('Analysis config received:', config)

    console.log('Creating Gmail analyzer...')
    const analyzer = new GmailAnalyzer(session.accessToken, session.user?.email || '')

    console.log('Running full analysis...')
    const report = await analyzer.runFullAnalysis(config)

    // Save report to database
    const dbReport = await saveReportToDatabase(report, session.user?.email || '')

    // Convert BigInt values to numbers for JSON serialization
    const serializableReport = convertBigIntToNumber(report)

    return NextResponse.json({
      success: true,
      reportId: dbReport.id,
      report: serializableReport
    })

  } catch (error) {
    console.error('Analysis error:', error)
    return NextResponse.json({
      error: 'Analysis failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}