'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Mail, Calendar, Trash2, Eye, Brain, HardDrive } from 'lucide-react'
import Link from 'next/link'
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

export default function ReportsPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const toast = useToast()
  const { confirmPromise } = useConfirmDialog()
  const [reports, setReports] = useState<ReportSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session) {
      router.push('/')
      return
    }

    const fetchReports = async () => {
      try {
        setLoading(true)
        const response = await fetch('/api/reports')

        if (response.ok) {
          const data = await response.json()
          setReports(data.reports)
        } else {
          console.error('Failed to fetch reports:', response.statusText)
          setReports([])
        }
      } catch (error) {
        console.error('Error fetching reports:', error)
        setReports([])
      } finally {
        setLoading(false)
      }
    }

    fetchReports()
  }, [session, router])

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
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const handleDeleteReport = async (reportId: string) => {
    const confirmed = await confirmPromise(
      'Delete Report',
      'Are you sure you want to delete this report? This action cannot be undone.',
      { variant: 'danger', confirmText: 'Delete Report' }
    )
    if (!confirmed) return

    try {
      const response = await fetch('/api/reports', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reportId })
      })

      if (response.ok) {
        // Remove the report from local state
        setReports(reports.filter(r => r.id !== reportId))
        toast.success('Report Deleted', 'Report deleted successfully!')
      } else {
        const errorData = await response.json()
        console.error('Failed to delete report:', errorData)
        toast.error('Delete Failed', `Failed to delete report: ${errorData.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Error deleting report:', error)
      toast.error('Delete Failed', 'Failed to delete report. Please try again.')
    }
  }


  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-800">Loading reports...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/"
          className="inline-flex items-center text-gray-800 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Analysis Reports</h1>
            <p className="text-gray-800 mt-2">View and manage your email analysis history</p>
          </div>
          <Link
            href="/analyze"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            New Analysis
          </Link>
        </div>
      </div>

      {/* Reports List */}
      {reports.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm p-8 text-center">
          <Mail className="h-12 w-12 mx-auto text-gray-600 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Reports Yet</h3>
          <p className="text-gray-800 mb-4">
            Start your first email analysis to see cleanup recommendations
          </p>
          <Link
            href="/analyze"
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Analyze Emails
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {reports.map((report) => (
            <div
              key={report.id}
              className="bg-white rounded-lg shadow-sm border border-gray-200 p-6"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3 mb-2">
                    <h3 className="text-lg font-medium text-gray-900">
                      {report.description}
                    </h3>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {report.mode} mode
                    </span>
                  </div>

                  <div className="flex items-center space-x-6 text-sm text-gray-800 mb-4">
                    <div className="flex items-center space-x-1">
                      <Calendar className="h-4 w-4" />
                      <span>{formatDate(report.createdAt)}</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <Mail className="h-4 w-4" />
                      <span>{report.totalEmails} emails analyzed</span>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-4 gap-4">
                    <div className="bg-red-50 rounded-lg p-3">
                      <div className="flex items-center">
                        <Trash2 className="h-5 w-5 text-red-600" />
                        <div className="ml-3">
                          <p className="text-sm font-medium text-red-900">Deletion Candidates</p>
                          <p className="text-lg font-bold text-red-900">{report.deletionCandidates}</p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-purple-50 rounded-lg p-3">
                      <div className="flex items-center">
                        <Mail className="h-5 w-5 text-purple-600" />
                        <div className="ml-3">
                          <p className="text-sm font-medium text-purple-900">Newsletter Senders</p>
                          <p className="text-lg font-bold text-purple-900">{report.newsletterSenders}</p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-green-50 rounded-lg p-3">
                      <div className="flex items-center">
                        <HardDrive className="h-5 w-5 text-green-600" />
                        <div className="ml-3">
                          <p className="text-sm font-medium text-green-900">Potential Savings</p>
                          <p className="text-lg font-bold text-green-900">
                            {formatSize(report.potentialSavings)}
                          </p>
                        </div>
                      </div>
                    </div>

                    {report.tokenTotalCount !== undefined && (() => {
                      const costBreakdown = calculateCostFromTokens(
                        report.tokenInputCount || 0,
                        report.tokenOutputCount || 0
                      )

                      // Show different display for zero cost vs actual cost
                      const hasActualCost = costBreakdown.totalCost > 0
                      const displayText = hasActualCost
                        ? costBreakdown.formatted
                        : 'No AI used'

                      return (
                        <div className="bg-yellow-50 rounded-lg p-3">
                          <div className="flex items-center">
                            <Brain className="h-5 w-5 text-yellow-600" />
                            <div className="ml-3">
                              <p className="text-sm font-medium text-yellow-900">AI Cost</p>
                              <p className="text-lg font-bold text-yellow-900">
                                {displayText}
                              </p>
                              {hasActualCost ? (
                                <p className="text-xs text-yellow-700">
                                  {formatTokenCount(report.tokenTotalCount)} tokens
                                </p>
                              ) : (
                                <p className="text-xs text-yellow-700">
                                  Pattern-based analysis
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                </div>

                <div className="flex flex-col space-y-2 ml-6">
                  <Link
                    href={`/results/${report.id}`}
                    className="inline-flex items-center px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    View Details
                  </Link>

                  <button
                    onClick={() => handleDeleteReport(report.id)}
                    className="inline-flex items-center px-3 py-2 bg-red-100 text-red-700 text-sm rounded-lg hover:bg-red-200"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}