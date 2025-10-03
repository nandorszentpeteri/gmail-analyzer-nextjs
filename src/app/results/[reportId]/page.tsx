'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Trash2, Mail, CheckCircle, XCircle, Filter, Search, Calendar, Tag, User, Users, TrendingUp, HardDrive, Brain } from 'lucide-react'
import Link from 'next/link'
import { useToast } from '@/components/ui/Toast'
import { useConfirmDialog } from '@/components/ui/ConfirmDialog'
import { calculateAICost, formatTokenCount } from '@/utils/aiCost'

interface EmailCandidate {
  id: string
  subject: string
  from: string
  date: string
  size: number
  category: string
  reasoning: string
  confidence?: string
}

interface NewsletterSender {
  senderEmail: string
  senderName: string
  count: number
  totalSize: number
  category: string
}

interface SenderFrequency {
  rank: number
  senderEmail: string
  senderName: string
  count: number
  totalSize: number
  percentage: number
  avgEmailSize: number
  category: string
  domain?: string
  domainStats?: {
    uniqueSenders: number
    totalCount: number
    totalSize: number
  }
}

interface DomainGroup {
  domain: string
  domainStats: {
    uniqueSenders: number
    totalCount: number
    totalSize: number
  }
  senders: Array<{
    senderEmail: string
    senderName: string
    count: number
    totalSize: number
    latestDate: string
    category: string
  }>
}

interface AnalysisReport {
  summary: {
    totalEmails: number
    deletionCandidates: number
    keepCandidates?: number
    newsletterSenders: number
    uniqueDomains?: number
    totalSize: number
    potentialSavings: number
    analysisType?: string
  }
  deletionCandidates: EmailCandidate[]
  keepCandidates?: EmailCandidate[]
  newsletterSenders: NewsletterSender[]
  senderFrequency?: SenderFrequency[]
  domainGroups?: DomainGroup[]
  tokenUsage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    requestCount: number
  }
  config: {
    description: string
    limit: number
    mode: string
  }
  createdAt: string
}

export default function ResultsPage() {
  const params = useParams()
  const router = useRouter()
  const toast = useToast()
  const { confirmDelete } = useConfirmDialog()
  const [report, setReport] = useState<AnalysisReport | null>(null)
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'deletion' | 'keep' | 'newsletters' | 'sender_frequency'>('deletion')
  const [selectionFilter, setSelectionFilter] = useState<'all' | 'newsletters' | 'large'>('all')

  // Search and filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [senderFilter, setSenderFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [sizeFilter, setSizeFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [sortBy, setSortBy] = useState<'date' | 'size' | 'subject'>('size')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    const fetchReport = async () => {
      if (!params.reportId) return

      try {
        setLoading(true)
        const response = await fetch(`/api/reports/${params.reportId}`)

        if (response.ok) {
          const data = await response.json()
          setReport(data.report)


          // Set default tab based on analysis type
          if (data.report.summary.analysisType === 'sender_frequency') {
            setActiveTab('sender_frequency')
          }
        } else {
          console.error('Failed to fetch report:', response.statusText)
          setReport(null)
        }
      } catch (error) {
        console.error('Error fetching report:', error)
        setReport(null)
      } finally {
        setLoading(false)
      }
    }

    fetchReport()
  }, [params.reportId])

  const formatSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024)
    if (mb > 1024) {
      return `${(mb / 1024).toFixed(1)} GB`
    }
    return `${mb.toFixed(1)} MB`
  }

  // Filtered and sorted emails for deletion candidates
  const filteredDeletionEmails = useMemo(() => {
    if (!report) return []

    let filtered = report.deletionCandidates.filter(email => {
      // Search query filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        if (
          !email.subject.toLowerCase().includes(query) &&
          !email.from.toLowerCase().includes(query) &&
          !email.reasoning.toLowerCase().includes(query)
        ) {
          return false
        }
      }

      // Sender filter
      if (senderFilter && !email.from.toLowerCase().includes(senderFilter.toLowerCase())) {
        return false
      }

      // Category filter
      if (categoryFilter && email.category !== categoryFilter) {
        return false
      }

      // Size filter
      if (sizeFilter) {
        const sizeInMB = email.size / (1024 * 1024)
        switch (sizeFilter) {
          case 'small':
            if (sizeInMB >= 1) return false
            break
          case 'medium':
            if (sizeInMB < 1 || sizeInMB >= 10) return false
            break
          case 'large':
            if (sizeInMB < 10) return false
            break
        }
      }

      // Date filter
      if (dateFilter) {
        const emailDate = new Date(email.date)
        const now = new Date()
        const daysDiff = (now.getTime() - emailDate.getTime()) / (1000 * 60 * 60 * 24)

        switch (dateFilter) {
          case 'week':
            if (daysDiff > 7) return false
            break
          case 'month':
            if (daysDiff > 30) return false
            break
          case 'quarter':
            if (daysDiff > 90) return false
            break
          case 'year':
            if (daysDiff > 365) return false
            break
        }
      }

      return true
    })

    // Sort emails
    filtered.sort((a, b) => {
      let comparison = 0

      switch (sortBy) {
        case 'date':
          comparison = new Date(a.date).getTime() - new Date(b.date).getTime()
          break
        case 'size':
          comparison = a.size - b.size
          break
        case 'subject':
          comparison = a.subject.localeCompare(b.subject)
          break
      }

      return sortOrder === 'desc' ? -comparison : comparison
    })

    return filtered
  }, [report, searchQuery, senderFilter, categoryFilter, sizeFilter, dateFilter, sortBy, sortOrder])

  // Filtered and sorted emails for keep candidates
  const filteredKeepEmails = useMemo(() => {
    if (!report || !report.keepCandidates) return []

    let filtered = report.keepCandidates.filter(email => {
      // Search query filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        if (
          !email.subject.toLowerCase().includes(query) &&
          !email.from.toLowerCase().includes(query) &&
          !email.reasoning.toLowerCase().includes(query)
        ) {
          return false
        }
      }

      // Sender filter
      if (senderFilter && !email.from.toLowerCase().includes(senderFilter.toLowerCase())) {
        return false
      }

      // Category filter
      if (categoryFilter && email.category !== categoryFilter) {
        return false
      }

      // Size filter
      if (sizeFilter) {
        const sizeInMB = email.size / (1024 * 1024)
        switch (sizeFilter) {
          case 'small':
            if (sizeInMB >= 1) return false
            break
          case 'medium':
            if (sizeInMB < 1 || sizeInMB >= 10) return false
            break
          case 'large':
            if (sizeInMB < 10) return false
            break
        }
      }

      // Date filter
      if (dateFilter) {
        const emailDate = new Date(email.date)
        const now = new Date()
        const daysDiff = (now.getTime() - emailDate.getTime()) / (1000 * 60 * 60 * 24)

        switch (dateFilter) {
          case 'week':
            if (daysDiff > 7) return false
            break
          case 'month':
            if (daysDiff > 30) return false
            break
          case 'quarter':
            if (daysDiff > 90) return false
            break
          case 'year':
            if (daysDiff > 365) return false
            break
        }
      }

      return true
    })

    // Sort emails
    filtered.sort((a, b) => {
      let comparison = 0

      switch (sortBy) {
        case 'date':
          comparison = new Date(a.date).getTime() - new Date(b.date).getTime()
          break
        case 'size':
          comparison = a.size - b.size
          break
        case 'subject':
          comparison = a.subject.localeCompare(b.subject)
          break
      }

      return sortOrder === 'desc' ? -comparison : comparison
    })

    return filtered
  }, [report, searchQuery, senderFilter, categoryFilter, sizeFilter, dateFilter, sortBy, sortOrder])

  // Get the current filtered emails based on active tab
  const currentFilteredEmails = activeTab === 'keep' ? filteredKeepEmails : filteredDeletionEmails

  // Get total count for current tab
  const currentTabTotalCount = activeTab === 'keep'
    ? (report?.keepCandidates?.length || 0)
    : activeTab === 'deletion'
      ? (report?.deletionCandidates?.length || 0)
      : 0

  // Get unique senders and categories for filter options
  const uniqueSenders = useMemo(() => {
    if (!report) return []
    const allEmails = [...report.deletionCandidates, ...(report.keepCandidates || [])]
    const senders = new Set(allEmails.map(email => {
      const match = email.from.match(/<([^>]+)>/) || email.from.match(/([^\s<>]+@[^\s<>]+)/)
      return match ? match[1] : email.from
    }))
    return Array.from(senders).sort()
  }, [report])

  const uniqueCategories = useMemo(() => {
    if (!report) return []
    const allEmails = [...report.deletionCandidates, ...(report.keepCandidates || [])]
    const categories = new Set(allEmails.map(email => email.category))
    return Array.from(categories).sort()
  }, [report])

  const clearAllFilters = () => {
    setSearchQuery('')
    setSenderFilter('')
    setCategoryFilter('')
    setSizeFilter('')
    setDateFilter('')
    setSelectionFilter('all')
  }

  const toggleEmailSelection = (emailId: string) => {
    const newSelected = new Set(selectedEmails)
    if (newSelected.has(emailId)) {
      newSelected.delete(emailId)
    } else {
      newSelected.add(emailId)
    }
    setSelectedEmails(newSelected)
  }

  const selectEmailsByFilter = (filter: string) => {
    let emailsToSelect: string[] = []

    switch (filter) {
      case 'all':
        emailsToSelect = currentFilteredEmails.map(email => email.id)
        break
      case 'newsletters':
        emailsToSelect = currentFilteredEmails
          .filter(email => email.category === 'newsletter' || email.category === 'promotional')
          .map(email => email.id)
        break
      case 'large':
        emailsToSelect = currentFilteredEmails
          .filter(email => email.size > 1024 * 1024) // > 1MB
          .map(email => email.id)
        break
    }

    setSelectedEmails(new Set(emailsToSelect))
    setSelectionFilter(filter)
  }

  const selectAllFiltered = () => {
    setSelectedEmails(new Set(currentFilteredEmails.map(email => email.id)))
  }

  const clearSelection = () => {
    setSelectedEmails(new Set())
  }

  const handleBulkDelete = () => {
    if (selectedEmails.size === 0) {
      toast.warning('No emails selected', 'Please select emails to delete first.')
      return
    }

    confirmDelete(selectedEmails.size, async () => {
      try {
        const response = await fetch('/api/delete-emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emailIds: Array.from(selectedEmails) })
        })

        if (response.ok) {
          const data = await response.json()

          // Check if there were authentication issues
          if (data.authenticationRequired) {
            toast.warning(
              'Partial Success',
              `${data.results.successful} emails deleted, ${data.results.failed} failed. ${data.message}`
            )
          } else {
            toast.success(
              'Emails Deleted',
              `Successfully deleted ${data.results.successful} emails!`
            )
          }

          // Remove successfully deleted emails from the list
          if (report && data.results.details) {
            const successfulIds = new Set(data.results.details.successful)
            const updatedCandidates = report.deletionCandidates.filter(
              email => !successfulIds.has(email.id)
            )
            setReport({
              ...report,
              deletionCandidates: updatedCandidates,
              summary: {
                ...report.summary,
                deletionCandidates: updatedCandidates.length
              }
            })
          }

          setSelectedEmails(new Set())
        } else {
          toast.error('Deletion Failed', 'Failed to delete emails. Please try again.')
        }
      } catch (error) {
        console.error('Delete error:', error)
        toast.error('Error', 'An error occurred while deleting emails. Please try again.')
      }
    })
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-700">Loading analysis results...</p>
        </div>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center">
          <p className="text-gray-700">Report not found.</p>
          <Link href="/" className="text-blue-600 hover:underline">
            Return to Dashboard
          </Link>
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
          className="inline-flex items-center text-gray-700 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Link>
        <h1 className="text-3xl font-bold text-gray-900">Analysis Results</h1>
        <p className="text-gray-700 mt-2">{report.config.description}</p>
      </div>

      {/* Summary Cards */}
      <div className={`grid gap-6 mb-8 ${report.tokenUsage ? 'md:grid-cols-4 lg:grid-cols-5' : 'md:grid-cols-4'}`}>
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <Mail className="h-8 w-8 text-blue-600" />
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-700">Total Emails</p>
              <p className="text-2xl font-bold text-gray-900">{report.summary.totalEmails}</p>
            </div>
          </div>
        </div>

        {report.summary.analysisType === 'sender_frequency' ? (
          <>
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center">
                <Users className="h-8 w-8 text-teal-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-700">Unique Senders</p>
                  <p className="text-2xl font-bold text-gray-900">{report.summary.newsletterSenders}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center">
                <TrendingUp className="h-8 w-8 text-orange-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-700">Top 10 Senders</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {report.senderFrequency?.slice(0, 10).reduce((sum, s) => sum + s.count, 0) || 0}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center">
                <Mail className="h-8 w-8 text-green-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-700">Total Size</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {formatSize(report.summary.totalSize)}
                  </p>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center">
                <Trash2 className="h-8 w-8 text-red-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-700">Deletion Candidates</p>
                  <p className="text-2xl font-bold text-gray-900">{report.summary.deletionCandidates}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center">
                <CheckCircle className="h-8 w-8 text-green-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-700">Keep Candidates</p>
                  <p className="text-2xl font-bold text-gray-900">{report.summary.keepCandidates || 0}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center">
                <Mail className="h-8 w-8 text-purple-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-700">Newsletter Senders</p>
                  <p className="text-2xl font-bold text-gray-900">{report.summary.newsletterSenders}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center">
                <HardDrive className="h-8 w-8 text-orange-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-700">Space Savings</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {formatSize(report.summary.potentialSavings)}
                  </p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Token Usage Card */}
        {report.tokenUsage && (() => {
          const costBreakdown = calculateAICost(report.tokenUsage)

          return (
            <div className="bg-white rounded-lg shadow-sm p-6 col-span-2">
              <div className="flex items-center">
                <Brain className="h-8 w-8 text-yellow-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-700">AI Cost</p>
                  <p className="text-2xl font-bold text-gray-900">{costBreakdown.formatted}</p>
                  <div className="text-xs text-gray-600 mt-1">
                    {report.tokenUsage.requestCount} requests • {formatTokenCount(report.tokenUsage.totalTokens)} tokens
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Input: {formatTokenCount(report.tokenUsage.inputTokens)} • Output: {formatTokenCount(report.tokenUsage.outputTokens)}
                  </div>
                </div>
              </div>
            </div>
          )
        })()}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow-sm">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex">
            {report.summary.analysisType === 'sender_frequency' ? (
              <button
                onClick={() => setActiveTab('sender_frequency')}
                className={`py-4 px-6 border-b-2 font-medium text-sm ${
                  activeTab === 'sender_frequency'
                    ? 'border-teal-500 text-teal-600'
                    : 'border-transparent text-gray-700 hover:text-gray-700'
                }`}
              >
                Sender Frequency ({report.summary.newsletterSenders} senders)
              </button>
            ) : (
              <>
                <button
                  onClick={() => setActiveTab('deletion')}
                  className={`py-4 px-6 border-b-2 font-medium text-sm ${
                    activeTab === 'deletion'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-700 hover:text-gray-700'
                  }`}
                >
                  Deletion Candidates ({report.summary.deletionCandidates})
                </button>
                <button
                  onClick={() => setActiveTab('keep')}
                  className={`py-4 px-6 border-b-2 font-medium text-sm ${
                    activeTab === 'keep'
                      ? 'border-green-500 text-green-600'
                      : 'border-transparent text-gray-700 hover:text-gray-700'
                  }`}
                >
                  Keep Candidates ({report.summary.keepCandidates || 0})
                </button>
                <button
                  onClick={() => setActiveTab('newsletters')}
                  className={`py-4 px-6 border-b-2 font-medium text-sm ${
                    activeTab === 'newsletters'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-700 hover:text-gray-700'
                  }`}
                >
                  Newsletter Senders ({report.summary.newsletterSenders})
                </button>
              </>
            )}
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'deletion' && (
            <div>
              {/* Search Bar */}
              <div className="mb-6">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-600" />
                  <input
                    type="text"
                    placeholder="Search emails by subject, sender, or reason..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Advanced Filters */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <button
                    onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                    className="flex items-center space-x-2 text-gray-700 hover:text-gray-900"
                  >
                    <Filter className="h-4 w-4" />
                    <span>Advanced Filters</span>
                  </button>

                  <div className="flex items-center space-x-4">
                    <span className="text-sm text-gray-700">
                      Showing {currentFilteredEmails.length} of {currentTabTotalCount} emails
                    </span>
                    {(searchQuery || senderFilter || categoryFilter || sizeFilter || dateFilter) && (
                      <button
                        onClick={clearAllFilters}
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        Clear All Filters
                      </button>
                    )}
                  </div>
                </div>

                {showAdvancedFilters && (
                  <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg">
                    {/* Sender Filter */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <User className="inline h-4 w-4 mr-1" />
                        Sender
                      </label>
                      <select
                        value={senderFilter}
                        onChange={(e) => setSenderFilter(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">All senders</option>
                        {uniqueSenders.map(sender => (
                          <option key={sender} value={sender}>{sender}</option>
                        ))}
                      </select>
                    </div>

                    {/* Category Filter */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <Tag className="inline h-4 w-4 mr-1" />
                        Category
                      </label>
                      <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">All categories</option>
                        {uniqueCategories.map(category => (
                          <option key={category} value={category}>
                            {category.charAt(0).toUpperCase() + category.slice(1)}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Size Filter */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        📎 Size
                      </label>
                      <select
                        value={sizeFilter}
                        onChange={(e) => setSizeFilter(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">All sizes</option>
                        <option value="small">Small (&lt;1MB)</option>
                        <option value="medium">Medium (1-10MB)</option>
                        <option value="large">Large (&gt;10MB)</option>
                      </select>
                    </div>

                    {/* Date Filter */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <Calendar className="inline h-4 w-4 mr-1" />
                        Date
                      </label>
                      <select
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">All dates</option>
                        <option value="week">Last week</option>
                        <option value="month">Last month</option>
                        <option value="quarter">Last 3 months</option>
                        <option value="year">Last year</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Sorting Controls */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center space-x-4">
                  <span className="text-sm font-medium text-gray-700">Sort by:</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as 'date' | 'size' | 'subject')}
                    className="px-3 py-1 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="size">Size</option>
                    <option value="date">Date</option>
                    <option value="subject">Subject</option>
                  </select>
                  <button
                    onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                    className="px-3 py-1 border border-gray-300 rounded-md text-sm hover:bg-gray-50"
                  >
                    {sortOrder === 'desc' ? '↓' : '↑'}
                  </button>
                </div>
              </div>

              {/* Selection Controls */}
              <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <div className="flex items-center space-x-4">
                  <span className="text-sm font-medium text-gray-700">Selection:</span>
                  <button
                    onClick={selectAllFiltered}
                    className="px-3 py-1 rounded-md text-sm bg-blue-600 text-white hover:bg-blue-700"
                  >
                    Select All ({currentFilteredEmails.length})
                  </button>
                  <button
                    onClick={clearSelection}
                    className="px-3 py-1 rounded-md text-sm bg-gray-100 text-gray-700 hover:bg-gray-200"
                  >
                    Deselect All
                  </button>
                </div>

                <div className="flex items-center space-x-4">
                  <span className="text-sm font-medium text-gray-700">Quick Select:</span>
                  <button
                    onClick={() => selectEmailsByFilter('newsletters')}
                    className="px-3 py-1 rounded-md text-sm bg-purple-100 text-purple-700 hover:bg-purple-200"
                  >
                    Newsletters Only
                  </button>
                  <button
                    onClick={() => selectEmailsByFilter('large')}
                    className="px-3 py-1 rounded-md text-sm bg-orange-100 text-orange-700 hover:bg-orange-200"
                  >
                    Large Files (&gt;1MB)
                  </button>
                </div>

                <div className="flex items-center space-x-4">
                  <span className="text-sm text-gray-700">
                    {selectedEmails.size} selected
                  </span>
                  <button
                    onClick={handleBulkDelete}
                    disabled={selectedEmails.size === 0}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>Delete Selected</span>
                  </button>
                </div>
              </div>

              {/* Email List */}
              <div className="space-y-2">
                {currentFilteredEmails.length === 0 ? (
                  <div className="text-center py-8 text-gray-700">
                    <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No emails match your current filters</p>
                    <button
                      onClick={clearAllFilters}
                      className="mt-2 text-blue-600 hover:text-blue-800"
                    >
                      Clear all filters
                    </button>
                  </div>
                ) : (
                  currentFilteredEmails.map((email) => (
                    <div
                      key={email.id}
                      className={`p-3 border rounded cursor-pointer transition-colors ${
                        selectedEmails.has(email.id)
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                      onClick={() => toggleEmailSelection(email.id)}
                    >
                      <div className="flex items-start space-x-3">
                        {/* Checkbox Column */}
                        <input
                          type="checkbox"
                          checked={selectedEmails.has(email.id)}
                          onChange={() => toggleEmailSelection(email.id)}
                          className="mt-0.5"
                        />
                        
                        {/* Main Content Column */}
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-medium text-gray-900 truncate">
                            {email.subject}
                          </h3>
                          <p className="text-xs text-gray-600 truncate">From: {email.from}</p>
                          <p className="text-xs text-gray-600 mt-1 line-clamp-1">{email.reasoning}</p>
                          <span className="text-xs text-gray-500 mt-1">{email.date}</span>
                        </div>

                        {/* Right Side Badges Column */}
                        <div className="flex flex-col items-end space-y-1 flex-shrink-0 min-w-0">
                          <div className="flex items-center space-x-2">
                            <span className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded ${
                              email.category === 'newsletter' ? 'bg-purple-100 text-purple-700' :
                              email.category === 'promotional' ? 'bg-orange-100 text-orange-700' :
                              email.category === 'automated' ? 'bg-blue-100 text-blue-700' :
                              'bg-gray-100 text-gray-700'
                            }`}>
                              {email.category}
                            </span>
                            <span className="text-xs text-gray-600">
                              {formatSize(email.size)}
                            </span>
                          </div>
                          {email.confidence && (
                            <span className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded ${
                              email.confidence === 'high' ? 'bg-green-100 text-green-700' :
                              email.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                              'bg-red-100 text-red-700'
                            }`}>
                              {email.confidence}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'keep' && (
            <div>
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Emails Worth Keeping</h3>
                <p className="text-gray-700">
                  These emails were analyzed and determined to be important, relevant, or valuable to keep.
                </p>
              </div>

              {/* Search Bar */}
              <div className="mb-6">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-600" />
                  <input
                    type="text"
                    placeholder="Search emails by subject, sender, or reason..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Advanced Filters */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <button
                    onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                    className="flex items-center space-x-2 text-gray-700 hover:text-gray-900"
                  >
                    <Filter className="h-4 w-4" />
                    <span>Advanced Filters</span>
                  </button>

                  <div className="flex items-center space-x-4">
                    <span className="text-sm text-gray-700">
                      Showing {currentFilteredEmails.length} of {currentTabTotalCount} emails
                    </span>
                    {(searchQuery || senderFilter || categoryFilter || sizeFilter || dateFilter) && (
                      <button
                        onClick={clearAllFilters}
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        Clear All Filters
                      </button>
                    )}
                  </div>
                </div>

                {showAdvancedFilters && (
                  <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg">
                    {/* Same filters as deletion tab */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <User className="inline h-4 w-4 mr-1" />
                        Sender
                      </label>
                      <select
                        value={senderFilter}
                        onChange={(e) => setSenderFilter(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-green-500"
                      >
                        <option value="">All senders</option>
                        {uniqueSenders.map(sender => (
                          <option key={sender} value={sender}>{sender}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <Tag className="inline h-4 w-4 mr-1" />
                        Category
                      </label>
                      <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-green-500"
                      >
                        <option value="">All categories</option>
                        {uniqueCategories.map(category => (
                          <option key={category} value={category}>
                            {category.charAt(0).toUpperCase() + category.slice(1)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        📎 Size
                      </label>
                      <select
                        value={sizeFilter}
                        onChange={(e) => setSizeFilter(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-green-500"
                      >
                        <option value="">All sizes</option>
                        <option value="small">Small (&lt;1MB)</option>
                        <option value="medium">Medium (1-10MB)</option>
                        <option value="large">Large (&gt;10MB)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <Calendar className="inline h-4 w-4 mr-1" />
                        Date
                      </label>
                      <select
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-green-500"
                      >
                        <option value="">All dates</option>
                        <option value="week">Last week</option>
                        <option value="month">Last month</option>
                        <option value="quarter">Last 3 months</option>
                        <option value="year">Last year</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Sorting Controls */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center space-x-4">
                  <span className="text-sm font-medium text-gray-700">Sort by:</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as 'date' | 'size' | 'subject')}
                    className="px-3 py-1 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-green-500"
                  >
                    <option value="size">Size</option>
                    <option value="date">Date</option>
                    <option value="subject">Subject</option>
                  </select>
                  <button
                    onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                    className="px-3 py-1 border border-gray-300 rounded-md text-sm hover:bg-gray-50"
                  >
                    {sortOrder === 'desc' ? '↓' : '↑'}
                  </button>
                </div>
              </div>

              {/* Email List */}
              <div className="space-y-2">
                {currentFilteredEmails.length === 0 ? (
                  <div className="text-center py-8 text-gray-700">
                    <CheckCircle className="h-12 w-12 mx-auto mb-4 opacity-50 text-green-500" />
                    <p>No emails match your current filters</p>
                    <button
                      onClick={clearAllFilters}
                      className="mt-2 text-green-600 hover:text-green-800"
                    >
                      Clear all filters
                    </button>
                  </div>
                ) : (
                  currentFilteredEmails.map((email) => (
                    <div
                      key={`keep-${email.id}`}
                      className="p-3 border border-green-200 rounded hover:border-green-300 transition-colors bg-green-50"
                    >
                      <div className="flex items-start space-x-3">
                        <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <h3 className="text-sm font-medium text-gray-900 truncate">
                                {email.subject}
                              </h3>
                              <p className="text-xs text-gray-600 truncate">From: {email.from}</p>
                            </div>
                            <div className="flex items-center space-x-2 flex-shrink-0">
                              <span className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded ${
                                email.category === 'newsletter' ? 'bg-purple-100 text-purple-700' :
                                email.category === 'promotional' ? 'bg-orange-100 text-orange-700' :
                                email.category === 'automated' ? 'bg-blue-100 text-blue-700' :
                                email.category === 'personal' ? 'bg-green-100 text-green-700' :
                                'bg-gray-100 text-gray-700'
                              }`}>
                                {email.category}
                              </span>
                              <span className="text-xs text-gray-600">
                                {formatSize(email.size)}
                              </span>
                              {email.confidence && (
                                <span className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded ${
                                  email.confidence === 'high' ? 'bg-green-100 text-green-700' :
                                  email.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-red-100 text-red-700'
                                }`}>
                                  {email.confidence}
                                </span>
                              )}
                            </div>
                          </div>
                          <p className="text-xs text-gray-600 mt-1 line-clamp-1">{email.reasoning}</p>
                          <span className="text-xs text-gray-500 mt-1">{email.date}</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'newsletters' && (
            <div className="space-y-4">
              <p className="text-gray-700 mb-4">
                Consider unsubscribing from these newsletter senders to reduce future email volume:
              </p>
              {report.newsletterSenders.map((sender, index) => (
                <div
                  key={`newsletter-${sender.senderEmail}-${index}`}
                  className="p-4 border border-gray-200 rounded-lg"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-gray-900">{sender.senderName}</h3>
                      <p className="text-sm text-gray-700">{sender.senderEmail}</p>
                      <div className="flex items-center space-x-4 mt-2 text-sm text-gray-700">
                        <span>📧 {sender.count} emails</span>
                        <span>💾 {formatSize(sender.totalSize)} total</span>
                      </div>
                    </div>
                    <button className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                      View Emails
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'sender_frequency' && (report.domainGroups || report.senderFrequency) && (
            <div className="space-y-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Email Senders Grouped by Domain</h3>
                  <p className="text-gray-700 mt-1">
                    Discover which domains and specific senders are filling up your inbox the most
                  </p>
                </div>
                <div className="text-sm text-gray-600">
                  {report.summary.uniqueDomains} domains • {report.summary.newsletterSenders} unique senders
                </div>
              </div>

              <div className="space-y-6">
                {report.domainGroups ? report.domainGroups.map((domainGroup, domainIndex) => {
                  const domainPercentage = Math.round((domainGroup.domainStats.totalCount / report.summary.totalEmails) * 100 * 10) / 10

                  return (
                    <div
                      key={`domain-${domainGroup.domain}-${domainIndex}`}
                      className="border border-gray-200 rounded-lg overflow-hidden"
                    >
                      {/* Domain Header */}
                      <div className="bg-gradient-to-r from-teal-50 to-blue-50 p-4 border-b border-gray-200">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div className="flex items-center justify-center w-10 h-10 bg-teal-100 text-teal-800 rounded-full text-sm font-bold">
                              #{domainIndex + 1}
                            </div>
                            <div>
                              <h4 className="text-lg font-semibold text-gray-900">@{domainGroup.domain}</h4>
                              <p className="text-sm text-gray-600">
                                {domainGroup.domainStats.uniqueSenders} unique sender{domainGroup.domainStats.uniqueSenders !== 1 ? 's' : ''}
                              </p>
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="flex items-center space-x-6 text-sm">
                              <div className="flex items-center space-x-2">
                                <Mail className="h-4 w-4 text-blue-500" />
                                <span className="text-gray-700">
                                  <strong>{domainGroup.domainStats.totalCount}</strong> emails
                                </span>
                              </div>

                              <div className="flex items-center space-x-2">
                                <TrendingUp className="h-4 w-4 text-orange-500" />
                                <span className="text-gray-700">
                                  <strong>{domainPercentage}%</strong> of total
                                </span>
                              </div>

                              <div className="flex items-center space-x-2">
                                <HardDrive className="h-4 w-4 text-green-500" />
                                <span className="text-gray-700">
                                  <strong>{formatSize(domainGroup.domainStats.totalSize)}</strong>
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Domain progress bar */}
                        <div className="mt-3 bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-gradient-to-r from-teal-500 to-blue-500 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${Math.min(domainPercentage * 2, 100)}%` }}
                          ></div>
                        </div>
                      </div>

                      {/* Individual Senders */}
                      <div className="divide-y divide-gray-100">
                        {domainGroup.senders.map((sender, senderIndex) => {
                          const senderPercentage = Math.round((sender.count / report.summary.totalEmails) * 100 * 10) / 10
                          const avgEmailSize = Math.round(sender.totalSize / sender.count)

                          return (
                            <div
                              key={`sender-${sender.senderEmail}-${senderIndex}`}
                              className="p-4 hover:bg-gray-50 transition-colors"
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center space-x-3 mb-2">
                                    <div className="flex items-center justify-center w-6 h-6 bg-gray-100 text-gray-600 rounded text-xs font-medium">
                                      {senderIndex + 1}
                                    </div>
                                    <div>
                                      <h5 className="font-medium text-gray-900">{sender.senderName}</h5>
                                      <p className="text-sm text-gray-600">{sender.senderEmail}</p>
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm ml-9">
                                    <div className="flex items-center space-x-2">
                                      <Mail className="h-3 w-3 text-blue-500" />
                                      <span className="text-gray-700">
                                        <strong>{sender.count}</strong> emails
                                      </span>
                                    </div>

                                    <div className="flex items-center space-x-2">
                                      <TrendingUp className="h-3 w-3 text-orange-500" />
                                      <span className="text-gray-700">
                                        <strong>{senderPercentage}%</strong> of total
                                      </span>
                                    </div>

                                    <div className="flex items-center space-x-2">
                                      <CheckCircle className="h-3 w-3 text-green-500" />
                                      <span className="text-gray-700">
                                        <strong>{formatSize(sender.totalSize)}</strong> total
                                      </span>
                                    </div>

                                    <div className="flex items-center space-x-2">
                                      <Mail className="h-3 w-3 text-purple-500" />
                                      <span className="text-gray-700">
                                        <strong>{formatSize(avgEmailSize)}</strong> avg
                                      </span>
                                    </div>
                                  </div>

                                  <div className="mt-2 flex items-center space-x-2 ml-9">
                                    <span className={`inline-flex px-2 py-1 text-xs font-medium rounded ${
                                      sender.category === 'newsletter' ? 'bg-purple-100 text-purple-700' :
                                      sender.category === 'promotional' ? 'bg-orange-100 text-orange-700' :
                                      sender.category === 'personal' ? 'bg-green-100 text-green-700' :
                                      sender.category === 'automated' ? 'bg-blue-100 text-blue-700' :
                                      'bg-gray-100 text-gray-700'
                                    }`}>
                                      {sender.category}
                                    </span>

                                    {/* Individual sender progress bar */}
                                    <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                                      <div
                                        className="bg-teal-400 h-1.5 rounded-full transition-all duration-300"
                                        style={{ width: `${Math.min(senderPercentage * 3, 100)}%` }}
                                      ></div>
                                    </div>
                                  </div>
                                </div>

                                <button className="ml-6 px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors">
                                  View Emails
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                }) : null}

                {/* Fallback: Show simple sender list when domainGroups not available */}
                {!report.domainGroups && report.senderFrequency && (
                  <div className="space-y-4">
                    <h4 className="text-lg font-semibold text-gray-900">Top Email Senders</h4>
                    {report.senderFrequency.map((sender, index) => (
                      <div key={`sender-${sender.senderEmail}-${index}`} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-3 mb-2">
                              <div className="flex items-center justify-center w-8 h-8 bg-teal-100 text-teal-800 rounded text-sm font-medium">
                                {sender.rank}
                              </div>
                              <div>
                                <h5 className="font-medium text-gray-900">{sender.senderName}</h5>
                                <p className="text-sm text-gray-600">{sender.senderEmail}</p>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm ml-11">
                              <div className="flex items-center space-x-2">
                                <Mail className="h-3 w-3 text-blue-500" />
                                <span className="text-gray-700">
                                  <strong>{sender.count}</strong> emails
                                </span>
                              </div>

                              <div className="flex items-center space-x-2">
                                <span className="text-gray-700">
                                  <strong>{sender.percentage}%</strong> of total
                                </span>
                              </div>

                              <div className="flex items-center space-x-2">
                                <span className="text-gray-700">
                                  <strong>{formatSize(sender.totalSize)}</strong> total
                                </span>
                              </div>

                              <div className="flex items-center space-x-2">
                                <span className="text-gray-700">
                                  <strong>{formatSize(sender.avgEmailSize)}</strong> avg
                                </span>
                              </div>
                            </div>

                            {sender.category && (
                              <div className="mt-2 ml-11">
                                <span className={`inline-flex px-2 py-1 text-xs font-medium rounded ${
                                  sender.category === 'newsletter' ? 'bg-purple-100 text-purple-700' :
                                  sender.category === 'promotional' ? 'bg-orange-100 text-orange-700' :
                                  sender.category === 'personal' ? 'bg-green-100 text-green-700' :
                                  sender.category === 'automated' ? 'bg-blue-100 text-blue-700' :
                                  'bg-gray-100 text-gray-700'
                                }`}>
                                  {sender.category}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {(!report.domainGroups && !report.senderFrequency) && (
                <div className="text-center py-8 text-gray-600">
                  <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No sender data found in this analysis</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}