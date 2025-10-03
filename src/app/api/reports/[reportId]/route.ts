import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]/route'
import { getReportById } from '@/lib/database'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  try {
    const { reportId } = await params
    const session = await getServerSession(authOptions)

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const report = await getReportById(reportId, session.user.email)

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    // Determine if this is a sender frequency analysis
    const isSenderFrequencyAnalysis = report.deletionCandidates === 0 && report.newsletterSender.length > 0

    // Format the report for frontend
    const formattedReport = {
      summary: {
        totalEmails: report.totalEmails,
        deletionCandidates: report.deletionCandidates,
        keepCandidates: report.keepCandidates || 0,
        newsletterSenders: report.newsletterSenders,
        totalSize: Number(report.totalSize),
        potentialSavings: Number(report.potentialSavings),
        analysisType: isSenderFrequencyAnalysis ? 'sender_frequency' : 'cleanup'
      },
      deletionCandidates: report.emailCandidates
        .filter(email => email.recommendationType === 'delete')
        .map(email => ({
          id: email.emailId,
          subject: email.subject,
          from: email.from,
          date: email.date,
          size: Number(email.size),
          category: email.category,
          reasoning: email.reasoning,
          confidence: email.confidence
        })),
      keepCandidates: report.emailCandidates
        .filter(email => email.recommendationType === 'keep')
        .map(email => ({
          id: email.emailId,
          subject: email.subject,
          from: email.from,
          date: email.date,
          size: Number(email.size),
          category: email.category,
          reasoning: email.reasoning,
          confidence: email.confidence
        })),
      newsletterSenders: report.newsletterSender.map(sender => ({
        senderEmail: sender.senderEmail,
        senderName: sender.senderName,
        count: sender.count,
        totalSize: Number(sender.totalSize),
        category: sender.category
      })),
      // For sender frequency analysis, add the formatted data
      senderFrequency: isSenderFrequencyAnalysis ? report.newsletterSender.map((sender, index) => ({
        rank: index + 1,
        senderEmail: sender.senderEmail,
        senderName: sender.senderName,
        count: sender.count,
        totalSize: Number(sender.totalSize),
        percentage: Math.round((sender.count / report.totalEmails) * 100 * 10) / 10,
        avgEmailSize: Math.round(Number(sender.totalSize) / sender.count),
        category: sender.category
      })) : undefined,
      config: {
        description: report.description,
        limit: report.limit,
        mode: report.mode
      },
      // Add token usage data if available
      tokenUsage: report.tokenTotalCount && report.tokenTotalCount > 0 ? {
        inputTokens: report.tokenInputCount || 0,
        outputTokens: report.tokenOutputCount || 0,
        totalTokens: report.tokenTotalCount || 0,
        requestCount: report.aiRequestCount || 0
      } : undefined,
      createdAt: report.createdAt.toISOString()
    }

    return NextResponse.json({ success: true, report: formattedReport })

  } catch (error) {
    console.error('Get report error:', error)
    return NextResponse.json({
      error: 'Failed to get report',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}