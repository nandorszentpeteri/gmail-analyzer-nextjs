import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]/route'
import { getReportsByUser, deleteReport } from '@/lib/database'

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const reports = await getReportsByUser(session.user.email)

    // Format reports for frontend (flat structure)
    const formattedReports = reports.map(report => ({
      id: report.id,
      createdAt: report.createdAt.toISOString(),
      description: report.description,
      mode: report.mode,
      limit: report.limit,
      totalEmails: report.totalEmails,
      deletionCandidates: report.deletionCandidates,
      newsletterSenders: report.newsletterSenders,
      potentialSavings: Number(report.potentialSavings),
      tokenInputCount: report.tokenInputCount,
      tokenOutputCount: report.tokenOutputCount,
      tokenTotalCount: report.tokenTotalCount,
      aiRequestCount: report.aiRequestCount
    }))

    return NextResponse.json({ success: true, reports: formattedReports })

  } catch (error) {
    console.error('List reports error:', error)
    return NextResponse.json({
      error: 'Failed to list reports',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { reportId } = body

    if (!reportId) {
      return NextResponse.json({ error: 'Report ID is required' }, { status: 400 })
    }

    // Delete the report (with cascade delete for related data)
    const result = await deleteReport(reportId, session.user.email)

    if (result.count === 0) {
      return NextResponse.json({ error: 'Report not found or access denied' }, { status: 404 })
    }

    return NextResponse.json({ success: true, message: 'Report deleted successfully' })

  } catch (error) {
    console.error('Delete report error:', error)
    return NextResponse.json({
      error: 'Failed to delete report',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}