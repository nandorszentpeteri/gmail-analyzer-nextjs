import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { google } from 'googleapis'
import { authOptions } from '../auth/[...nextauth]/route'
import { deleteEmailsByGmailIds, cleanupReportsAfterDeletion } from '@/lib/database'

// Token refresh function (copied from auth route)
async function refreshAccessToken(token: any) {
  try {
    const url = 'https://oauth2.googleapis.com/token'

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
      }),
    })

    const refreshedTokens = await response.json()

    if (!response.ok) {
      throw refreshedTokens
    }

    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      accessTokenExpires: Date.now() + refreshedTokens.expires_in * 1000,
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
    }
  } catch (error) {
    console.error('Error refreshing access token:', error)
    return {
      ...token,
      error: 'RefreshAccessTokenError',
    }
  }
}

// Enhanced Gmail client setup with token refresh
async function setupGmailClient(session: any) {
  let accessToken = session.accessToken
  let refreshToken = session.refreshToken

  // Check if token needs refresh (if it expires within 5 minutes)
  const tokenExpiresAt = session.accessTokenExpires || 0
  const shouldRefresh = Date.now() >= tokenExpiresAt - 5 * 60 * 1000

  if (shouldRefresh && refreshToken) {
    console.log('Access token expired or expiring soon, refreshing...')

    const refreshedToken = await refreshAccessToken({
      accessToken,
      refreshToken,
      accessTokenExpires: tokenExpiresAt
    })

    if (refreshedToken.error) {
      throw new Error('Failed to refresh access token')
    }

    accessToken = refreshedToken.accessToken
    refreshToken = refreshedToken.refreshToken
  }

  const auth = new google.auth.OAuth2()
  auth.setCredentials({ access_token: accessToken })

  return {
    gmail: google.gmail({ version: 'v1', auth }),
    accessToken,
    refreshToken
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized - No access token' }, { status: 401 })
    }

    // Check if we have refresh token available
    if (!session.refreshToken) {
      console.warn('⚠️ No refresh token available in session')
    }

    const { emailIds } = await req.json()

    if (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0) {
      return NextResponse.json({ error: 'No email IDs provided' }, { status: 400 })
    }

    // Set up Gmail client with token refresh handling
    const { gmail } = await setupGmailClient(session)

    const results = {
      successful: [] as string[],
      failed: [] as { emailId: string; error: string }[]
    }

    console.log(`Starting batch deletion of ${emailIds.length} emails...`)

    // Process emails in batches for efficiency (Gmail allows up to 100 requests per batch)
    const batchSize = 50 // Conservative batch size
    const batches = []

    for (let i = 0; i < emailIds.length; i += batchSize) {
      const batch = emailIds.slice(i, i + batchSize)
      batches.push(batch)
    }

    console.log(`Processing ${batches.length} batches of up to ${batchSize} emails each...`)

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const currentBatch = batches[batchIndex]
      console.log(`🔄 Processing batch ${batchIndex + 1}/${batches.length} (${currentBatch.length} emails)...`)

      try {
        // Use Gmail batch delete API with full permissions
        await gmail.users.messages.batchDelete({
          userId: 'me',
          requestBody: {
            ids: currentBatch
          }
        })

        // All emails in batch succeeded
        results.successful.push(...currentBatch)
        console.log(`✅ Successfully batch deleted ${batchIndex + 1}/${batches.length}: ${currentBatch.length} emails`)

      } catch (error: any) {
        console.error(`❌ Batch ${batchIndex + 1} failed:`, error?.message || error)

        // Check if it's an auth error and try to refresh token
        if (error?.message?.includes('invalid authentication') ||
            error?.message?.includes('401') ||
            error?.code === 401) {

          console.log('🔄 Authentication error detected, attempting token refresh...')

          // Check if we have refresh token before attempting refresh
          if (!session.refreshToken) {
            console.error('❌ No refresh token available, user needs to re-authenticate')
            currentBatch.forEach(emailId => {
              results.failed.push({
                emailId,
                error: 'Authentication expired. Please sign out and sign back in.'
              })
            })
            continue
          }

          try {
            // Try to setup Gmail client again with fresh token
            const { gmail: refreshedGmail } = await setupGmailClient(session)

            // Retry the batch deletion with refreshed token
            await refreshedGmail.users.messages.batchDelete({
              userId: 'me',
              requestBody: {
                ids: currentBatch
              }
            })

            results.successful.push(...currentBatch)
            console.log(`✅ Successfully batch deleted ${batchIndex + 1}/${batches.length} after token refresh: ${currentBatch.length} emails`)

          } catch (retryError: any) {
            console.error(`❌ Batch ${batchIndex + 1} failed even after token refresh:`, retryError?.message || retryError)

            // If still getting auth errors after refresh, the refresh token is likely invalid
            if (retryError?.message?.includes('invalid authentication') ||
                retryError?.message?.includes('401') ||
                retryError?.code === 401) {
              currentBatch.forEach(emailId => {
                results.failed.push({
                  emailId,
                  error: 'Authentication session expired. Please sign out and sign back in to continue.'
                })
              })
            } else {
              // For other errors, try individual deletion as fallback
              console.log(`🔄 Falling back to individual deletion for batch ${batchIndex + 1}...`)

              for (const emailId of currentBatch) {
                try {
                  await refreshedGmail.users.messages.trash({
                    userId: 'me',
                    id: emailId
                  })
                  results.successful.push(emailId)
                } catch (individualError: any) {
                  results.failed.push({
                    emailId,
                    error: individualError instanceof Error ? individualError.message : 'Individual deletion failed'
                  })
                }
              }
            }
          }
        } else {
          // For non-auth errors, try individual deletion as fallback
          console.log(`🔄 Batch failed with non-auth error, falling back to individual deletion for batch ${batchIndex + 1}...`)

          for (const emailId of currentBatch) {
            try {
              await gmail.users.messages.trash({
                userId: 'me',
                id: emailId
              })
              results.successful.push(emailId)
            } catch (individualError: any) {
              results.failed.push({
                emailId,
                error: individualError instanceof Error ? individualError.message : 'Individual deletion failed'
              })
            }
          }
        }
      }
    }

    console.log(`📊 Deletion complete: ${results.successful.length} successful, ${results.failed.length} failed`)

    // Clean up successfully deleted emails from the database and reports
    if (results.successful.length > 0) {
      try {
        console.log(`🗄️ Cleaning up ${results.successful.length} deleted emails from database and reports...`)

        const userEmail = session.user?.email || ''

        // Clean up emails from database
        const emailCleanupResult = await deleteEmailsByGmailIds(userEmail, results.successful)
        console.log(`✅ Email database cleanup: removed ${emailCleanupResult.count} emails from local database`)

        // Clean up analysis reports
        const reportCleanupResult = await cleanupReportsAfterDeletion(userEmail, results.successful)
        console.log(`📊 Report cleanup: removed ${reportCleanupResult.deletedCandidates} email candidates, updated ${reportCleanupResult.updatedReports} reports, deleted ${reportCleanupResult.deletedReports} empty reports`)

      } catch (cleanupError) {
        console.error('❌ Database/report cleanup failed:', cleanupError)
        // Don't fail the entire operation if database cleanup fails
        // The emails were successfully deleted from Gmail, which is the primary goal
      }
    }

    // Check if there were authentication issues
    const authErrors = results.failed.filter(f =>
      f.error.includes('Authentication') ||
      f.error.includes('sign out and sign back in')
    )

    return NextResponse.json({
      success: true,
      results: {
        successful: results.successful.length,
        failed: results.failed.length,
        details: results
      },
      // Add helpful message if there were auth issues
      ...(authErrors.length > 0 && {
        authenticationRequired: true,
        message: `${authErrors.length} emails failed due to expired authentication. Please sign out and sign back in to continue deleting emails.`
      })
    })

  } catch (error) {
    console.error('Delete emails error:', error)
    return NextResponse.json({
      error: 'Failed to delete emails',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}