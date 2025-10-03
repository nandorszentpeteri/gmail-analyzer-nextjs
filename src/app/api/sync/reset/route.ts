import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]/route'
import { updateSyncStatus } from '@/lib/database'

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log(`Manually resetting sync status for user: ${session.user.email}`)

    // Reset the sync status
    await updateSyncStatus(session.user.email, {
      syncInProgress: false,
      errorMessage: 'Sync manually reset by user'
    })

    return NextResponse.json({
      success: true,
      message: 'Sync status has been reset'
    })

  } catch (error) {
    console.error('Sync reset error:', error)
    return NextResponse.json({
      error: 'Failed to reset sync status',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}