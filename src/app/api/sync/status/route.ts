import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]/route'
import { getSyncStatus, updateSyncStatus } from '@/lib/database'

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const syncStatus = await getSyncStatus(session.user.email)

    // Check if sync has been stuck for more than 10 minutes
    const isStuck = syncStatus?.syncInProgress && syncStatus?.updatedAt &&
      (Date.now() - new Date(syncStatus.updatedAt).getTime()) > 10 * 60 * 1000

    if (isStuck) {
      console.log('Detected stuck sync, resetting status...')
      // Reset the stuck sync status
      await updateSyncStatus(session.user.email, {
        syncInProgress: false,
        errorMessage: 'Previous sync was interrupted and has been reset'
      })

      // Return the reset status
      return NextResponse.json({
        inProgress: false,
        lastSync: syncStatus?.lastSync?.toISOString(),
        totalEmails: syncStatus?.totalEmails || 0,
        errorMessage: 'Previous sync was interrupted and has been reset'
      })
    }

    return NextResponse.json({
      inProgress: syncStatus?.syncInProgress || false,
      lastSync: syncStatus?.lastSync?.toISOString(),
      totalEmails: syncStatus?.totalEmails || 0,
      errorMessage: syncStatus?.errorMessage
    })

  } catch (error) {
    console.error('Sync status error:', error)
    return NextResponse.json({
      error: 'Failed to get sync status',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}