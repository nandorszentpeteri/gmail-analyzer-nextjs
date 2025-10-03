import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// Database utility functions
export async function createUser(email: string, name?: string, image?: string) {
  return prisma.user.upsert({
    where: { email },
    update: { name, image },
    create: { email, name, image }
  })
}

export async function createReport(data: {
  userEmail: string
  description: string
  mode: string
  limit: number
  totalEmails: number
  deletionCandidates: number
  keepCandidates?: number
  newsletterSenders: number
  totalSize: bigint
  potentialSavings: bigint
  tokenInputCount?: number
  tokenOutputCount?: number
  tokenTotalCount?: number
  aiRequestCount?: number
}) {
  return prisma.report.create({
    data
  })
}

export async function createEmailCandidates(reportId: string, candidates: Array<{
  emailId: string
  subject: string
  from: string
  date: string
  size: bigint
  category: string
  reasoning: string
  recommendationType?: string
  confidence?: string
}>) {
  return prisma.emailCandidate.createMany({
    data: candidates.map(candidate => ({
      reportId,
      recommendationType: candidate.recommendationType || 'delete',
      confidence: candidate.confidence,
      ...candidate
    }))
  })
}

export async function createNewsletterSenders(reportId: string, senders: Array<{
  senderEmail: string
  senderName: string
  count: number
  totalSize: bigint
  category: string
}>) {
  return prisma.newsletterSender.createMany({
    data: senders.map(sender => ({
      reportId,
      ...sender
    }))
  })
}

export async function getReportsByUser(userEmail: string) {
  return prisma.report.findMany({
    where: { userEmail },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      description: true,
      mode: true,
      limit: true,
      createdAt: true,
      totalEmails: true,
      deletionCandidates: true,
      newsletterSenders: true,
      potentialSavings: true,
      tokenInputCount: true,
      tokenOutputCount: true,
      tokenTotalCount: true,
      aiRequestCount: true
    }
  })
}

export async function getReportById(reportId: string, userEmail: string) {
  return prisma.report.findFirst({
    where: {
      id: reportId,
      userEmail
    },
    include: {
      emailCandidates: {
        orderBy: { date: 'desc' }
      },
      newsletterSender: {
        orderBy: { count: 'desc' }
      }
    }
  })
}

export async function deleteReport(reportId: string, userEmail: string) {
  try {
    // Delete the report (cascade deletes will handle related records)
    const result = await prisma.report.deleteMany({
      where: {
        id: reportId,
        userEmail // Ensure user owns the report
      }
    })

    return { count: result.count }
  } catch (error) {
    console.error('Database delete error:', error)
    return { count: 0 }
  }
}

// Migration helper: Convert file-based reports to database
export async function migrateFileReport(fileReport: any) {
  const userEmail = fileReport.userEmail
  const reportId = fileReport.reportId

  // Create user if doesn't exist
  await createUser(userEmail)

  // Create report
  const report = await createReport({
    userEmail,
    description: fileReport.config.description,
    mode: fileReport.config.mode,
    limit: fileReport.config.limit,
    totalEmails: fileReport.summary.totalEmails,
    deletionCandidates: fileReport.summary.deletionCandidates,
    newsletterSenders: fileReport.summary.newsletterSenders,
    totalSize: BigInt(fileReport.summary.totalSize || 0),
    potentialSavings: BigInt(fileReport.summary.potentialSavings || 0)
  })

  // Create email candidates if they exist
  if (fileReport.deletionCandidates?.length > 0) {
    await createEmailCandidates(
      report.id,
      fileReport.deletionCandidates.map((email: any) => ({
        emailId: email.id,
        subject: email.subject,
        from: email.from,
        date: email.date,
        size: BigInt(email.size),
        category: email.category,
        reasoning: email.reasoning
      }))
    )
  }

  // Create newsletter senders if they exist
  if (fileReport.newsletterSenders?.length > 0) {
    await createNewsletterSenders(
      report.id,
      fileReport.newsletterSenders.map((sender: any) => ({
        senderEmail: sender.senderEmail,
        senderName: sender.senderName,
        count: sender.count,
        totalSize: BigInt(sender.totalSize),
        category: sender.category
      }))
    )
  }

  return report
}

// Email sync functions
export async function createOrUpdateEmails(userEmail: string, emails: Array<{
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
}>) {
  return prisma.$transaction(async (tx) => {
    const results = []

    for (const email of emails) {
      const result = await tx.email.upsert({
        where: { gmailId: email.gmailId },
        update: {
          ...email,
          labels: JSON.stringify(email.labels),
          attachmentInfo: email.attachmentInfo ? JSON.stringify(email.attachmentInfo) : null,
          lastSynced: new Date()
        },
        create: {
          userEmail,
          ...email,
          labels: JSON.stringify(email.labels),
          attachmentInfo: email.attachmentInfo ? JSON.stringify(email.attachmentInfo) : null,
        }
      })
      results.push(result)
    }

    return results
  })
}

export async function deleteOrphanedEmails(userEmail: string, validGmailIds: string[]) {
  return prisma.email.deleteMany({
    where: {
      userEmail,
      gmailId: { notIn: validGmailIds }
    }
  })
}

export async function getSyncStatus(userEmail: string) {
  return prisma.syncStatus.findUnique({
    where: { userEmail }
  })
}

export async function updateSyncStatus(userEmail: string, data: {
  lastSync?: Date
  totalEmails?: number
  syncInProgress?: boolean
  syncOptions?: any
  errorMessage?: string
}) {
  return prisma.syncStatus.upsert({
    where: { userEmail },
    update: {
      ...data,
      syncOptions: data.syncOptions ? JSON.stringify(data.syncOptions) : undefined,
      updatedAt: new Date()
    },
    create: {
      userEmail,
      ...data,
      syncOptions: data.syncOptions ? JSON.stringify(data.syncOptions) : undefined,
    }
  })
}

export async function getEmailsByUser(userEmail: string, filters?: {
  timeRange?: string
  category?: string
  senderEmail?: string
  limit?: number
  offset?: number
}) {
  const where: any = { userEmail }

  if (filters?.timeRange) {
    const cutoffDate = new Date()
    if (filters.timeRange === '7d') cutoffDate.setDate(cutoffDate.getDate() - 7)
    else if (filters.timeRange === '30d') cutoffDate.setDate(cutoffDate.getDate() - 30)
    else if (filters.timeRange === '3m') cutoffDate.setMonth(cutoffDate.getMonth() - 3)
    else if (filters.timeRange === '6m') cutoffDate.setMonth(cutoffDate.getMonth() - 6)
    else if (filters.timeRange === '1y') cutoffDate.setFullYear(cutoffDate.getFullYear() - 1)

    if (filters.timeRange !== 'all') {
      where.date = { gte: cutoffDate }
    }
  }

  if (filters?.category) {
    where.category = filters.category
  }

  if (filters?.senderEmail) {
    where.senderEmail = filters.senderEmail
  }

  return prisma.email.findMany({
    where,
    orderBy: { date: 'desc' },
    take: filters?.limit,
    skip: filters?.offset
  })
}

export async function getSenderFrequencyFromDb(userEmail: string, filters?: {
  timeRange?: string
  limit?: number
}) {
  // This uses raw SQL for better performance with grouping
  const timeFilter = filters?.timeRange && filters.timeRange !== 'all' ?
    (() => {
      const cutoffDate = new Date()
      if (filters.timeRange === '7d') cutoffDate.setDate(cutoffDate.getDate() - 7)
      else if (filters.timeRange === '30d') cutoffDate.setDate(cutoffDate.getDate() - 30)
      else if (filters.timeRange === '3m') cutoffDate.setMonth(cutoffDate.getMonth() - 3)
      else if (filters.timeRange === '6m') cutoffDate.setMonth(cutoffDate.getMonth() - 6)
      else if (filters.timeRange === '1y') cutoffDate.setFullYear(cutoffDate.getFullYear() - 1)
      return cutoffDate.toISOString()
    })() : null

  const sql = `
    SELECT
      senderEmail,
      senderName,
      COUNT(*) as count,
      SUM(size) as totalSize,
      MAX(date) as latestDate,
      category
    FROM emails
    WHERE userEmail = ?
    ${timeFilter ? 'AND date >= ?' : ''}
    GROUP BY senderEmail, senderName, category
    ORDER BY count DESC
    ${filters?.limit ? `LIMIT ${filters.limit}` : ''}
  `

  const params = timeFilter ? [userEmail, timeFilter] : [userEmail]

  return prisma.$queryRawUnsafe(sql, ...params)
}

// New function for domain-grouped sender frequency analysis
export async function getSenderFrequencyGroupedByDomain(userEmail: string, filters?: {
  timeRange?: string
  limit?: number
}) {
  const timeFilter = filters?.timeRange && filters.timeRange !== 'all' ?
    (() => {
      const cutoffDate = new Date()
      if (filters.timeRange === '7d') cutoffDate.setDate(cutoffDate.getDate() - 7)
      else if (filters.timeRange === '30d') cutoffDate.setDate(cutoffDate.getDate() - 30)
      else if (filters.timeRange === '3m') cutoffDate.setMonth(cutoffDate.getMonth() - 3)
      else if (filters.timeRange === '6m') cutoffDate.setMonth(cutoffDate.getMonth() - 6)
      else if (filters.timeRange === '1y') cutoffDate.setFullYear(cutoffDate.getFullYear() - 1)
      return cutoffDate.toISOString()
    })() : null

  // First get all individual senders
  const senderSql = `
    SELECT
      senderEmail,
      senderName,
      COUNT(*) as count,
      SUM(size) as totalSize,
      MAX(date) as latestDate,
      category,
      CASE
        WHEN senderEmail LIKE '%@%' THEN LOWER(SUBSTR(senderEmail, INSTR(senderEmail, '@') + 1))
        ELSE 'unknown'
      END as domain
    FROM emails
    WHERE userEmail = ?
    ${timeFilter ? 'AND date >= ?' : ''}
    GROUP BY senderEmail, senderName, category
    ORDER BY count DESC
  `

  // Get domain totals for sorting
  const domainSql = `
    SELECT
      CASE
        WHEN senderEmail LIKE '%@%' THEN LOWER(SUBSTR(senderEmail, INSTR(senderEmail, '@') + 1))
        ELSE 'unknown'
      END as domain,
      COUNT(DISTINCT senderEmail) as uniqueSenders,
      COUNT(*) as totalCount,
      SUM(size) as totalSize
    FROM emails
    WHERE userEmail = ?
    ${timeFilter ? 'AND date >= ?' : ''}
    GROUP BY domain
    ORDER BY totalCount DESC
    ${filters?.limit ? `LIMIT ${filters.limit}` : ''}
  `

  const params = timeFilter ? [userEmail, timeFilter] : [userEmail]

  const [senderResults, domainResults] = await Promise.all([
    prisma.$queryRawUnsafe(senderSql, ...params) as any[],
    prisma.$queryRawUnsafe(domainSql, ...params) as any[]
  ])

  // Group senders by domain, maintaining the domain order from domainResults
  const groupedData = domainResults.map(domainData => {
    const domainSenders = senderResults.filter(sender => sender.domain === domainData.domain)

    return {
      domain: domainData.domain,
      domainStats: {
        uniqueSenders: Number(domainData.uniqueSenders),
        totalCount: Number(domainData.totalCount),
        totalSize: Number(domainData.totalSize)
      },
      senders: domainSenders.map(sender => ({
        senderEmail: sender.senderEmail,
        senderName: sender.senderName,
        count: Number(sender.count),
        totalSize: Number(sender.totalSize),
        latestDate: sender.latestDate,
        category: sender.category
      })).sort((a, b) => b.count - a.count) // Sort senders within domain by count
    }
  })

  return groupedData
}

// Sync session functions
export async function createSyncSession(userEmail: string, options: any, dateRange: { startDate: Date | null, endDate: Date }) {
  return prisma.syncSession.create({
    data: {
      userEmail,
      status: 'in_progress',
      syncOptions: JSON.stringify(options),
      dateRangeStart: dateRange.startDate,
      dateRangeEnd: dateRange.endDate
    }
  })
}

export async function updateSyncSession(sessionId: string, updates: {
  status?: string
  emailsProcessed?: number
  totalEmails?: number
  currentBatch?: number
  totalBatches?: number
  errorMessage?: string
  completedAt?: Date
}) {
  return prisma.syncSession.update({
    where: { id: sessionId },
    data: {
      ...updates,
      updatedAt: new Date()
    }
  })
}

export async function getSyncSession(sessionId: string) {
  return prisma.syncSession.findUnique({
    where: { id: sessionId }
  })
}

export async function getActiveSyncSession(userEmail: string) {
  return prisma.syncSession.findFirst({
    where: {
      userEmail,
      status: 'in_progress'
    },
    orderBy: { startedAt: 'desc' }
  })
}

export async function cleanupEmailsInRange(userEmail: string, validGmailIds: string[], syncRange: { startDate: Date | null, endDate: Date }) {
  if (syncRange.startDate === null) {
    // Full sync - safe to delete all orphaned emails
    return prisma.email.deleteMany({
      where: {
        userEmail,
        gmailId: { notIn: validGmailIds }
      }
    })
  }

  // Partial sync - only delete orphaned emails within the synced date range
  return prisma.email.deleteMany({
    where: {
      userEmail,
      date: {
        gte: syncRange.startDate,
        lte: syncRange.endDate
      },
      gmailId: { notIn: validGmailIds }
    }
  })
}

export function getSyncDateRange(options: any): { startDate: Date | null, endDate: Date } {
  const now = new Date()
  let startDate: Date | null = null

  if (options.timeRange !== 'all') {
    startDate = new Date()

    switch (options.timeRange) {
      case '7d':
        startDate.setDate(now.getDate() - 7)
        break
      case '30d':
        startDate.setDate(now.getDate() - 30)
        break
      case '3m':
        startDate.setMonth(now.getMonth() - 3)
        break
      case '6m':
        startDate.setMonth(now.getMonth() - 6)
        break
      case '1y':
        startDate.setFullYear(now.getFullYear() - 1)
        break
    }
  }

  return { startDate, endDate: now }
}

// Delete emails from database by Gmail IDs (for when emails are deleted via Gmail API)
export async function deleteEmailsByGmailIds(userEmail: string, gmailIds: string[]) {
  return prisma.email.deleteMany({
    where: {
      userEmail,
      gmailId: { in: gmailIds }
    }
  })
}

// Clean up analysis reports after email deletion
export async function cleanupReportsAfterDeletion(userEmail: string, deletedGmailIds: string[]) {
  return prisma.$transaction(async (tx) => {
    // Find all email candidates that correspond to deleted emails
    const deletedCandidates = await tx.emailCandidate.findMany({
      where: {
        emailId: { in: deletedGmailIds },
        report: { userEmail }
      },
      select: {
        id: true,
        emailId: true,
        reportId: true,
        size: true
      }
    })

    if (deletedCandidates.length === 0) {
      return {
        deletedCandidates: 0,
        updatedReports: 0,
        deletedReports: 0
      }
    }

    console.log(`Found ${deletedCandidates.length} email candidates to remove from reports`)

    // Delete the email candidates
    await tx.emailCandidate.deleteMany({
      where: {
        id: { in: deletedCandidates.map(c => c.id) }
      }
    })

    // Group by report ID to update summaries
    const reportUpdates = new Map<string, { count: number, sizeReduction: bigint }>()

    deletedCandidates.forEach(candidate => {
      const current = reportUpdates.get(candidate.reportId) || { count: 0, sizeReduction: 0n }
      reportUpdates.set(candidate.reportId, {
        count: current.count + 1,
        sizeReduction: current.sizeReduction + BigInt(candidate.size)
      })
    })

    let updatedReports = 0
    let deletedReports = 0

    // Update each affected report
    for (const [reportId, { count, sizeReduction }] of reportUpdates) {
      // Get current report state
      const report = await tx.report.findUnique({
        where: { id: reportId },
        select: {
          id: true,
          deletionCandidates: true,
          potentialSavings: true,
          _count: {
            select: { emailCandidates: true }
          }
        }
      })

      if (!report) continue

      const remainingCandidates = report._count.emailCandidates

      if (remainingCandidates === 0) {
        // No candidates left, delete the entire report
        await tx.newsletterSender.deleteMany({ where: { reportId } })
        await tx.report.delete({ where: { id: reportId } })
        deletedReports++
        console.log(`Deleted empty report ${reportId}`)
      } else {
        // Update report summary
        await tx.report.update({
          where: { id: reportId },
          data: {
            deletionCandidates: report.deletionCandidates - count,
            potentialSavings: report.potentialSavings - sizeReduction
          }
        })
        updatedReports++
        console.log(`Updated report ${reportId}: removed ${count} candidates, reduced savings by ${sizeReduction}`)
      }
    }

    return {
      deletedCandidates: deletedCandidates.length,
      updatedReports,
      deletedReports
    }
  })
}