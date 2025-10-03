import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../../auth/[...nextauth]/route'
import { prisma } from '@/lib/database'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  try {
    const { reportId } = await params
    const session = await getServerSession(authOptions)

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { emailId, newRecommendationType } = await req.json()

    if (!emailId || !newRecommendationType || !['keep', 'delete'].includes(newRecommendationType)) {
      return NextResponse.json({
        error: 'Invalid request. emailId and newRecommendationType (keep/delete) are required.'
      }, { status: 400 })
    }

    // Verify the report belongs to the user
    const report = await prisma.report.findFirst({
      where: {
        id: reportId,
        userEmail: session.user.email
      }
    })

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    // Update the email candidate recommendation type
    const updatedEmail = await prisma.emailCandidate.updateMany({
      where: {
        reportId,
        emailId
      },
      data: {
        recommendationType: newRecommendationType
      }
    })

    if (updatedEmail.count === 0) {
      return NextResponse.json({ error: 'Email not found in this report' }, { status: 404 })
    }

    // Update the report summary counts
    const deletionCount = await prisma.emailCandidate.count({
      where: { reportId, recommendationType: 'delete' }
    })

    const keepCount = await prisma.emailCandidate.count({
      where: { reportId, recommendationType: 'keep' }
    })

    // Update the report summary
    await prisma.report.update({
      where: { id: reportId },
      data: {
        deletionCandidates: deletionCount,
        keepCandidates: keepCount
      }
    })

    return NextResponse.json({
      success: true,
      message: `Email moved to ${newRecommendationType} list`,
      newCounts: {
        deletionCandidates: deletionCount,
        keepCandidates: keepCount
      }
    })

  } catch (error) {
    console.error('Move email error:', error)
    return NextResponse.json({
      error: 'Failed to move email',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}