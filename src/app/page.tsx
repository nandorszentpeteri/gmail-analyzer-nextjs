'use client'

import { useSession, signIn, signOut } from 'next-auth/react'
import { Mail, BarChart3, Trash2, Settings, LogOut, Calendar, RefreshCw, Users, Database, Brain } from 'lucide-react'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { apiClient } from '@/utils/apiClient'
import { useTokenRefresh } from '@/hooks/useTokenRefresh'
import { useToast } from '@/components/ui/Toast'
import { useConfirmDialog } from '@/components/ui/ConfirmDialog'
import { calculateCostFromTokens, formatTokenCount } from '@/utils/aiCost'

interface ReportSummary {
  id: string
  createdAt: string
  description: string
  mode: string
  limit: number
  totalEmails: number
  deletionCandidates: number
  newsletterSenders: number
  potentialSavings: number
  tokenInputCount?: number
  tokenOutputCount?: number
  tokenTotalCount?: number
  aiRequestCount?: number
}

export default function Home() {
  const { data: session, status } = useSession()
  const toast = useToast()
  const { confirmPromise } = useConfirmDialog()
  const [recentReports, setRecentReports] = useState<ReportSummary[]>([])
  const [loadingReports, setLoadingReports] = useState(true)
  const [syncStatus, setSyncStatus] = useState<{
    inProgress: boolean
    lastSync?: string
    totalEmails?: number
    progress?: string
  }>({ inProgress: false })
  const [showSyncOptions, setShowSyncOptions] = useState(false)

  // Auto-refresh tokens when needed
  useTokenRefresh()

  // Fetch recent reports and sync status when user is logged in
  useEffect(() => {
    if (session) {
      fetchRecentReports()
      fetchSyncStatus()
    }
  }, [session])

  const fetchRecentReports = async () => {
    try {
      setLoadingReports(true)
      const response = await fetch('/api/reports')
      if (response.ok) {
        const data = await response.json()
        setRecentReports(data.reports.slice(0, 3)) // Show only 3 most recent
      }
    } catch (error) {
      console.error('Error fetching reports:', error)
    } finally {
      setLoadingReports(false)
    }
  }

  const fetchSyncStatus = async () => {
    try {
      const response = await apiClient.get('/api/sync/status')
      if (response.ok) {
        const data = await response.json()
        setSyncStatus(data)
      }
    } catch (error) {
      console.error('Error fetching sync status:', error)
    }
  }

  const handleAccountSwitch = async () => {
    const confirmed = await confirmPromise(
      'Switch Account',
      'Switch to a different Gmail account? You will be signed out and can sign in with another account.',
      { variant: 'warning', confirmText: 'Switch Account' }
    )
    if (confirmed) {
      signOut()
    }
  }

  const resetSync = async () => {
    const confirmed = await confirmPromise(
      'Reset Sync',
      'Reset the stuck sync status? This will stop any ongoing sync.',
      { variant: 'warning', confirmText: 'Reset Sync' }
    )
    if (confirmed) {
      try {
        const response = await apiClient.post('/api/sync/reset')
        if (response.ok) {
          await fetchSyncStatus()
          toast.success('Sync Reset', 'Sync status has been reset.')
        }
      } catch (error) {
        console.error('Reset sync error:', error)
        toast.error('Reset Failed', 'Failed to reset sync status.')
      }
    }
  }

  const startSync = async (options: any) => {
    try {
      setSyncStatus({ ...syncStatus, inProgress: true, progress: 'Starting sync...' })
      setShowSyncOptions(false)

      // Start polling for sync status updates
      const pollInterval = setInterval(async () => {
        if (syncStatus.inProgress) {
          await fetchSyncStatus()
        }
      }, 3000) // Poll every 3 seconds

      const response = await apiClient.post('/api/sync', options)

      // Clear polling
      clearInterval(pollInterval)

      if (response.ok) {
        const result = await response.json()
        console.log('Sync completed:', result)
        await fetchSyncStatus()
        await fetchRecentReports() // Refresh reports after sync

        // Show success message
        toast.success('Sync Complete', `${result.totalEmails} emails synced, ${result.deletedEmails} orphaned emails cleaned up.`)
      } else {
        const errorData = await response.json()
        toast.error('Sync Failed', errorData.error || 'Unknown error occurred')
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'Authentication expired') {
        // This is handled by apiClient, just inform user
        console.log('Authentication handled by apiClient')
      } else {
        console.error('Sync error:', error)
        toast.error('Sync Failed', 'Sync failed. Please try again.')
      }
    } finally {
      setSyncStatus({ ...syncStatus, inProgress: false, progress: undefined })
    }
  }

  const formatSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024)
    if (mb > 1024) {
      return `${(mb / 1024).toFixed(1)} GB`
    }
    return `${mb.toFixed(1)} MB`
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  if (status === 'loading') {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-800">Loading...</p>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center">
          <div className="mx-auto h-24 w-24 text-6xl mb-8">📧</div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Gmail Analyzer
          </h1>
          <p className="text-xl text-gray-800 mb-8 max-w-2xl mx-auto">
            AI-powered email cleanup tool that helps you maintain a clean inbox by identifying unimportant,
            outdated, and irrelevant emails for deletion.
          </p>

          <div className="bg-white rounded-lg shadow-md p-8 mb-8">
            <h2 className="text-2xl font-semibold mb-6">Features</h2>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="flex items-start space-x-3">
                <BarChart3 className="h-6 w-6 text-blue-600 mt-1" />
                <div>
                  <h3 className="font-medium">Smart Analysis</h3>
                  <p className="text-gray-800">AI analyzes your emails to identify unimportant and outdated content</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <Trash2 className="h-6 w-6 text-red-600 mt-1" />
                <div>
                  <h3 className="font-medium">Safe Deletion</h3>
                  <p className="text-gray-800">Preview and selectively delete emails with confidence</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <Mail className="h-6 w-6 text-green-600 mt-1" />
                <div>
                  <h3 className="font-medium">Relevance Detection</h3>
                  <p className="text-gray-800">Identifies outdated, promotional, and low-value emails</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <Settings className="h-6 w-6 text-purple-600 mt-1" />
                <div>
                  <h3 className="font-medium">Flexible Filters</h3>
                  <p className="text-gray-800">Custom queries for targeted email analysis</p>
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={() => signIn('google')}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-8 rounded-lg transition-colors inline-flex items-center space-x-2"
          >
            <Mail className="h-5 w-5" />
            <span>Connect Gmail Account</span>
          </button>

          <div className="mt-8 text-sm text-gray-700 max-w-md mx-auto">
            <p>🔒 Secure OAuth authentication</p>
            <p>📖 Read-only access to analyze emails</p>
            <p>🗑️ Optional delete permissions for cleanup</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* User Info Bar */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-8">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <img
              src={session.user?.image || ''}
              alt={session.user?.name || ''}
              className="h-10 w-10 rounded-full"
            />
            <div>
              <h2 className="font-medium text-gray-900">{session.user?.name}</h2>
              <p className="text-sm text-gray-800">{session.user?.email}</p>
              {syncStatus.lastSync && (
                <p className="text-xs text-gray-600">
                  Last synced: {new Date(syncStatus.lastSync).toLocaleDateString()}
                  {syncStatus.totalEmails && ` • ${syncStatus.totalEmails.toLocaleString()} emails`}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {syncStatus.inProgress ? (
              <div className="flex items-center space-x-2">
                <button
                  disabled
                  className="flex items-center space-x-2 bg-blue-100 text-blue-800 px-3 py-2 rounded-lg opacity-50"
                >
                  <Database className="h-4 w-4 animate-spin" />
                  <span>{syncStatus.progress || 'Syncing...'}</span>
                </button>
                <button
                  onClick={resetSync}
                  className="flex items-center space-x-2 bg-red-100 hover:bg-red-200 text-red-800 px-3 py-2 rounded-lg transition-colors"
                  title="Reset stuck sync"
                >
                  <span>Reset</span>
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowSyncOptions(true)}
                className="flex items-center space-x-2 bg-blue-100 hover:bg-blue-200 text-blue-800 px-3 py-2 rounded-lg transition-colors"
              >
                <Database className="h-4 w-4" />
                <span>Sync Emails</span>
              </button>
            )}
            <button
              onClick={handleAccountSwitch}
              className="flex items-center space-x-2 text-gray-600 hover:text-gray-800 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <Users className="h-4 w-4" />
              <span>Switch Account</span>
            </button>
            <button
              onClick={() => signOut()}
              className="flex items-center space-x-2 text-gray-600 hover:text-gray-800 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Dashboard */}
      <div className="grid lg:grid-cols-3 gap-8">
        {/* Quick Actions */}
        <div className="lg:col-span-1">
          <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
          <div className="space-y-3">
            <Link
              href="/analyze"
              className="block w-full bg-blue-600 hover:bg-blue-700 hover:shadow-lg text-white p-4 rounded-lg transition-all cursor-pointer text-left border-2 border-transparent hover:border-blue-400"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <BarChart3 className="h-5 w-5" />
                  <div>
                    <div className="font-medium">Analyze Emails</div>
                    <div className="text-sm opacity-90">Start new analysis</div>
                  </div>
                </div>
                <div className="text-white opacity-75">→</div>
              </div>
            </Link>

            <Link
              href="/reports"
              className="block w-full bg-gray-100 hover:bg-gray-200 hover:shadow-md text-gray-900 p-4 rounded-lg transition-all cursor-pointer text-left border-2 border-transparent hover:border-gray-300"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Mail className="h-5 w-5" />
                  <div>
                    <div className="font-medium">View Reports</div>
                    <div className="text-gray-700">Previous analyses</div>
                  </div>
                </div>
                <div className="text-gray-700">→</div>
              </div>
            </Link>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Recent Activity</h3>
            {recentReports.length > 0 && (
              <Link href="/reports" className="text-sm text-blue-600 hover:text-blue-800">
                View all →
              </Link>
            )}
          </div>
          <div className="bg-white rounded-lg shadow-sm p-6">
            {loadingReports ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-2 text-gray-600">Loading reports...</p>
              </div>
            ) : recentReports.length === 0 ? (
              <div className="text-center text-gray-700 py-8">
                <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No analyses yet</p>
                <p className="text-sm">Start your first email analysis to see results here</p>
              </div>
            ) : (
              <div className="space-y-4">
                {recentReports.map((report) => {
                  const aiCost = report.tokenTotalCount
                    ? calculateCostFromTokens(report.tokenInputCount || 0, report.tokenOutputCount || 0)
                    : null

                  return (
                    <Link key={report.id} href={`/results/${report.id}`}>
                      <div className="p-4 border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-md transition-all">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2 mb-2">
                              <h4 className="font-medium text-gray-900">{report.description}</h4>
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                {report.mode}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-gray-600">
                              <span className="flex items-center">
                                <Calendar className="h-3 w-3 mr-1" />
                                {formatDate(report.createdAt)}
                              </span>
                              <span className="flex items-center">
                                <Mail className="h-3 w-3 mr-1" />
                                {report.totalEmails} emails
                              </span>
                              <span className="flex items-center text-red-600">
                                <Trash2 className="h-3 w-3 mr-1" />
                                {report.deletionCandidates} candidates
                              </span>
                              {aiCost && aiCost.totalCost > 0 && (
                                <span className="flex items-center text-yellow-600">
                                  <Brain className="h-3 w-3 mr-1" />
                                  {aiCost.formatted}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="text-right ml-4">
                            <div className="text-sm font-medium text-green-600">
                              {formatSize(report.potentialSavings)}
                            </div>
                            <div className="text-xs text-gray-500">potential cleanup</div>
                            {report.newsletterSenders > 0 && (
                              <div className="text-xs text-purple-600 mt-1">
                                {report.newsletterSenders} senders
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sync Options Modal */}
      {showSyncOptions && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-semibold mb-4">Sync Email Options</h3>

            <SyncOptionsForm
              onSync={startSync}
              onCancel={() => setShowSyncOptions(false)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// Sync Options Form Component
function SyncOptionsForm({ onSync, onCancel }: {
  onSync: (options: any) => void
  onCancel: () => void
}) {
  const [options, setOptions] = useState({
    timeRange: '30d',
    customStartDate: '',
    customEndDate: '',
    excludeSpam: true,
    excludeTrash: true,
    maxEmailSize: 50
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSync(options)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Time Range
        </label>
        <select
          value={options.timeRange}
          onChange={(e) => setOptions({ ...options, timeRange: e.target.value })}
          className="w-full p-2 border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="3m">Last 3 months</option>
          <option value="6m">Last 6 months</option>
          <option value="1y">Last year</option>
          <option value="all">All time</option>
        </select>
      </div>

      <div className="space-y-2">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={options.excludeSpam}
            onChange={(e) => setOptions({ ...options, excludeSpam: e.target.checked })}
            className="mr-2"
          />
          <span className="text-sm">Exclude spam folder</span>
        </label>
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={options.excludeTrash}
            onChange={(e) => setOptions({ ...options, excludeTrash: e.target.checked })}
            className="mr-2"
          />
          <span className="text-sm">Exclude trash folder</span>
        </label>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Skip emails larger than (MB)
        </label>
        <input
          type="number"
          value={options.maxEmailSize}
          onChange={(e) => setOptions({ ...options, maxEmailSize: Number(e.target.value) })}
          min="1"
          max="100"
          className="w-full p-2 border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
        />
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <p className="text-sm text-blue-800">
          <strong>Privacy Note:</strong> Only email metadata (headers, dates, sizes) will be stored locally.
          Email content is only fetched when needed for AI analysis.
        </p>
      </div>

      <div className="flex space-x-3 pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Start Sync
        </button>
      </div>
    </form>
  )
}
