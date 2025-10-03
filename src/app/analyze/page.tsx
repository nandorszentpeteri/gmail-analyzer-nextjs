'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Mail, Calendar, Paperclip, Inbox, Search, Settings, Users } from 'lucide-react'
import Link from 'next/link'

interface AnalysisConfig {
  filterType: string
  query: string
  description: string
  limit: number
  mode: string
  attachmentSize?: string
  ageMonths?: string
  unreadAge?: string
  senderEmail?: string
  senderDomain?: string
  customQuery?: string
  analysisType?: string  // New field for different analysis types
}

export default function AnalyzePage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [config, setConfig] = useState<AnalysisConfig>({
    filterType: '',
    query: '',
    description: '',
    limit: 100,
    mode: 'auto'
  })
  const [currentStep, setCurrentStep] = useState(1)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!session) {
    router.push('/')
    return null
  }

  const filterOptions = [
    {
      id: 'all',
      title: 'All Emails',
      description: 'General cleanup analysis',
      icon: <Mail className="h-6 w-6" />,
      color: 'blue'
    },
    {
      id: 'promotions',
      title: 'Promotional Emails',
      description: 'Newsletters and marketing emails',
      icon: <Mail className="h-6 w-6" />,
      color: 'purple'
    },
    {
      id: 'large_attachments',
      title: 'Large Attachments',
      description: 'Emails with big file attachments',
      icon: <Paperclip className="h-6 w-6" />,
      color: 'orange'
    },
    {
      id: 'old_emails',
      title: 'Old Emails',
      description: 'Emails older than X months',
      icon: <Calendar className="h-6 w-6" />,
      color: 'green'
    },
    {
      id: 'unread',
      title: 'Unread Emails',
      description: 'Unread messages',
      icon: <Inbox className="h-6 w-6" />,
      color: 'red'
    },
    {
      id: 'specific_sender',
      title: 'Specific Sender',
      description: 'Emails from particular sender/domain',
      icon: <Search className="h-6 w-6" />,
      color: 'indigo'
    },
    {
      id: 'sender_frequency',
      title: 'Sender Frequency Analysis',
      description: 'Find most frequent email senders',
      icon: <Users className="h-6 w-6" />,
      color: 'teal'
    },
    {
      id: 'custom',
      title: 'Custom Query',
      description: 'Advanced Gmail search',
      icon: <Settings className="h-6 w-6" />,
      color: 'gray'
    }
  ]

  const handleFilterSelect = (filterType: string) => {
    let query = ''
    let description = ''

    switch (filterType) {
      case 'all':
        query = ''  // Empty query means all emails
        description = 'All emails'
        break
      case 'promotions':
        query = 'category:promotions'  // Gmail's standard promotions category
        description = 'Promotional emails and newsletters'
        break
      case 'sender_frequency':
        query = ''  // We'll analyze all emails to find frequent senders
        description = 'Sender frequency analysis'
        break
      default:
        description = filterOptions.find(f => f.id === filterType)?.title || ''
    }

    console.log('Filter selected:', { filterType, query, description })
    setConfig({ ...config, filterType, query, description })
    setCurrentStep(2)
  }

  const handleSubConfig = (updates: Partial<AnalysisConfig>) => {
    const newConfig = { ...config, ...updates }

    // Update query and description based on sub-configuration
    switch (config.filterType) {
      case 'large_attachments':
        newConfig.query = `has:attachment larger:${updates.attachmentSize}`
        newConfig.description = `Emails with attachments larger than ${updates.attachmentSize}`
        break
      case 'old_emails':
        newConfig.query = `older_than:${updates.ageMonths}`
        newConfig.description = `Emails older than ${updates.ageMonths}`
        break
      case 'unread':
        newConfig.query = updates.unreadAge || 'is:unread'
        newConfig.description = 'Unread emails'
        break
      case 'specific_sender':
        if (updates.senderEmail) {
          newConfig.query = `from:${updates.senderEmail}`
          newConfig.description = `Emails from ${updates.senderEmail}`
        } else if (updates.senderDomain) {
          newConfig.query = `from:@${updates.senderDomain}`
          newConfig.description = `Emails from @${updates.senderDomain}`
        }
        break
      case 'custom':
        newConfig.query = updates.customQuery || ''
        newConfig.description = `Custom query: ${updates.customQuery}`
        break
    }

    console.log('Sub-config applied:', { updates, newConfig })
    setConfig(newConfig)
    setCurrentStep(3)
  }

  const runAnalysis = async () => {
    setIsAnalyzing(true)
    setError(null)

    try {
      console.log('Starting analysis with config:', config)

      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      })

      console.log('Response status:', response.status)

      if (response.ok) {
        const result = await response.json()
        console.log('Analysis result:', result)
        router.push(`/results/${result.reportId}`)
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        console.error('Analysis failed:', errorData)
        setError(errorData.error || `Analysis failed with status ${response.status}`)
      }
    } catch (error) {
      console.error('Error running analysis:', error)
      setError(error instanceof Error ? error.message : 'Network error occurred')
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/"
          className="inline-flex items-center text-gray-800 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Link>
        <h1 className="text-3xl font-bold text-gray-900">Email Analysis</h1>
        <p className="text-gray-800 mt-2">Configure your email cleanup analysis</p>
      </div>

      {/* Progress Steps */}
      <div className="mb-8">
        <div className="flex items-center">
          {[1, 2, 3, 4].map((step) => (
            <div key={step} className="flex items-center">
              <div
                className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step <= currentStep
                    ? config.analysisType === 'sender_frequency' ? 'bg-teal-600 text-white' : 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-800'
                }`}
              >
                {step}
              </div>
              {step < 4 && (
                <div
                  className={`h-1 w-16 mx-2 ${
                    step < currentStep
                      ? config.analysisType === 'sender_frequency' ? 'bg-teal-600' : 'bg-blue-600'
                      : 'bg-gray-200'
                  }`}
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-between mt-2 text-sm text-gray-800">
          {config.analysisType === 'sender_frequency' ? (
            <>
              <span className="text-gray-800">Analysis Type</span>
              <span className="text-gray-800">Time Period</span>
              <span className="text-gray-800">Email Limit</span>
              <span className="text-gray-800">Review</span>
            </>
          ) : (
            <>
              <span className="text-gray-800">Filter Type</span>
              <span className="text-gray-800">Configuration</span>
              <span className="text-gray-800">Settings</span>
              <span className="text-gray-800">Review</span>
            </>
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center">
            <div className="text-red-600 mr-3">❌</div>
            <div>
              <h3 className="text-sm font-medium text-red-900">Analysis Failed</h3>
              <p className="text-sm text-red-700 mt-1">{error}</p>
            </div>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-400 hover:text-red-600"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Filter Type Selection */}
      {currentStep === 1 && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-semibold mb-4">Choose Analysis Type</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filterOptions.map((option) => (
              <button
                key={option.id}
                onClick={() => handleFilterSelect(option.id)}
                className="p-6 border border-gray-200 rounded-lg hover:border-blue-500 hover:shadow-md transition-all text-left"
              >
                <div className={`text-${option.color}-600 mb-3`}>
                  {option.icon}
                </div>
                <h3 className="font-medium text-gray-900 mb-2">{option.title}</h3>
                <p className="text-sm text-gray-800">{option.description}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Sub-Configuration */}
      {currentStep === 2 && config.filterType && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-semibold mb-4">Configure Filter</h2>

          {config.filterType === 'large_attachments' && (
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-2">
                Attachment Size Threshold
              </label>
              <div className="grid grid-cols-2 gap-3">
                {['1M', '5M', '10M', '25M'].map((size) => (
                  <button
                    key={size}
                    onClick={() => handleSubConfig({ attachmentSize: size })}
                    className="p-3 border border-gray-200 rounded-lg hover:border-blue-500 text-center"
                  >
                    Larger than {size}B
                  </button>
                ))}
              </div>
            </div>
          )}

          {config.filterType === 'old_emails' && (
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-2">
                Age Threshold
              </label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: '3m', label: '3 months' },
                  { value: '6m', label: '6 months' },
                  { value: '1y', label: '1 year' },
                  { value: '2y', label: '2 years' }
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => handleSubConfig({ ageMonths: option.value })}
                    className="p-3 border border-gray-200 rounded-lg hover:border-blue-500 text-center"
                  >
                    Older than {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {config.filterType === 'unread' && (
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-2">
                Unread Email Filter
              </label>
              <div className="space-y-2">
                {[
                  { value: 'is:unread', label: 'All unread emails' },
                  { value: 'is:unread older_than:7d', label: 'Unread older than 1 week' },
                  { value: 'is:unread older_than:1m', label: 'Unread older than 1 month' },
                  { value: 'is:unread older_than:3m', label: 'Unread older than 3 months' }
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => handleSubConfig({ unreadAge: option.value })}
                    className="w-full p-3 border border-gray-200 rounded-lg hover:border-blue-500 text-left"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {config.filterType === 'specific_sender' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-2">
                  Sender Email Address
                </label>
                <input
                  type="email"
                  placeholder="john@example.com"
                  className="w-full p-3 border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
                  onChange={(e) => setConfig({ ...config, senderEmail: e.target.value })}
                />
                <button
                  onClick={() => handleSubConfig({ senderEmail: config.senderEmail })}
                  className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  disabled={!config.senderEmail}
                >
                  Use This Email
                </button>
              </div>

              <div className="text-center text-gray-700">OR</div>

              <div>
                <label className="block text-sm font-medium text-gray-800 mb-2">
                  Domain (e.g., company.com)
                </label>
                <input
                  type="text"
                  placeholder="company.com"
                  className="w-full p-3 border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
                  onChange={(e) => setConfig({ ...config, senderDomain: e.target.value })}
                />
                <button
                  onClick={() => handleSubConfig({ senderDomain: config.senderDomain })}
                  className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  disabled={!config.senderDomain}
                >
                  Use This Domain
                </button>
              </div>
            </div>
          )}

          {config.filterType === 'custom' && (
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-2">
                Gmail Search Query
              </label>
              <textarea
                rows={3}
                placeholder="is:starred older_than:1y, has:attachment from:notifications"
                className="w-full p-3 border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
                onChange={(e) => setConfig({ ...config, customQuery: e.target.value })}
              />
              <button
                onClick={() => handleSubConfig({ customQuery: config.customQuery })}
                className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                disabled={!config.customQuery}
              >
                Use This Query
              </button>
            </div>
          )}

          {config.filterType === 'sender_frequency' && (
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4">Sender Frequency Analysis Options</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-2">
                    Time Period to Analyze
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { value: '', label: 'All time' },
                      { value: 'newer_than:3m', label: 'Last 3 months' },
                      { value: 'newer_than:6m', label: 'Last 6 months' },
                      { value: 'newer_than:1y', label: 'Last year' }
                    ].map((option) => (
                      <button
                        key={option.value}
                        onClick={() => {
                          const newConfig = {
                            ...config,
                            query: option.value,
                            description: `Sender frequency analysis - ${option.label}`,
                            analysisType: 'sender_frequency',
                            mode: 'fast'  // Set a default mode since it's not used anyway
                          }
                          setConfig(newConfig)
                          setCurrentStep(3)  // Go to step 3 for email limit selection
                        }}
                        className="p-3 border border-gray-200 rounded-lg hover:border-teal-500 text-center"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
                  <h4 className="font-medium text-teal-900 mb-2">What this analysis does:</h4>
                  <ul className="text-sm text-teal-800 space-y-1">
                    <li>• Fetches emails from the selected time period</li>
                    <li>• Counts how many emails each sender has sent you</li>
                    <li>• Calculates total storage used per sender</li>
                    <li>• Provides an ordered list from most to least frequent</li>
                    <li>• Helps identify which senders are filling up your inbox</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {['all', 'promotions'].includes(config.filterType) && (
            <div className="text-center">
              <p className="text-gray-800 mb-4">No additional configuration needed for this filter type.</p>
              <button
                onClick={() => setCurrentStep(3)}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Continue
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Analysis Settings */}
      {currentStep === 3 && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-semibold mb-4">
            {config.analysisType === 'sender_frequency' ? 'Email Limit' : 'Analysis Settings'}
          </h2>

          <div className="space-y-6">
            {/* Email Limit */}
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-2">
                Number of Emails to Analyze
              </label>
              {config.analysisType === 'sender_frequency' && (
                <p className="text-sm text-gray-600 mb-3">
                  More emails provide more accurate sender frequency data, but take longer to process.
                </p>
              )}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {(config.analysisType === 'sender_frequency' ? [
                    { value: 100, label: '100 emails (quick)' },
                    { value: 250, label: '250 emails (balanced)' },
                    { value: 500, label: '500 emails (thorough)' },
                    { value: 1000, label: '1000 emails (comprehensive)' }
                  ] : [
                    { value: 50, label: '50 emails (quick)' },
                    { value: 100, label: '100 emails (recommended)' },
                    { value: 250, label: '250 emails (thorough)' },
                    { value: 500, label: '500 emails (comprehensive)' }
                  ]).map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setConfig({ ...config, limit: option.value })}
                      className={`p-3 border rounded-lg text-center ${
                        config.limit === option.value
                          ? config.analysisType === 'sender_frequency'
                            ? 'border-teal-500 bg-teal-50'
                            : 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-400'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                {/* Custom limit input */}
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-2">
                    Or set a custom limit:
                  </label>
                  <div className="flex space-x-2">
                    <input
                      type="number"
                      min="10"
                      max="10000"
                      placeholder="e.g., 750"
                      className="flex-1 p-3 border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
                      onChange={(e) => {
                        const value = parseInt(e.target.value)
                        if (value && value >= 10 && value <= 10000) {
                          setConfig({ ...config, limit: value })
                        }
                      }}
                    />
                    <span className="flex items-center px-3 text-gray-600">emails</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">
                    Enter a number between 10 and 10,000 emails
                  </p>
                </div>
              </div>
            </div>

            {/* Analysis Mode - Only for non-sender-frequency analysis */}
            {config.analysisType !== 'sender_frequency' && (
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-2">
                  Analysis Mode
                </label>
                <div className="space-y-3">
                  {[
                    { value: 'auto', label: 'Auto (Smart)', desc: 'Fast for obvious cases, detailed when needed' },
                    { value: 'fast', label: 'Fast', desc: 'Quick analysis based on headers only' },
                    { value: 'full', label: 'Detailed', desc: 'Thorough analysis including content' }
                  ].map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setConfig({ ...config, mode: option.value })}
                      className={`w-full p-4 border rounded-lg text-left ${
                        config.mode === option.value
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-blue-500'
                      }`}
                    >
                      <div className="font-medium text-gray-900">{option.label}</div>
                      <div className="text-sm text-gray-800">{option.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {config.analysisType === 'sender_frequency' && (
              <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
                <h4 className="font-medium text-teal-900 mb-2">⚡ Fast Processing</h4>
                <p className="text-sm text-teal-800">
                  Sender frequency analysis only examines email headers and doesn't use AI,
                  making it much faster than cleanup analysis. Larger email limits have minimal impact on speed.
                </p>
              </div>
            )}
          </div>

          <div className="mt-6 flex space-x-3">
            <button
              onClick={() => setCurrentStep(2)}
              className="px-6 py-3 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Back
            </button>
            <button
              onClick={() => setCurrentStep(4)}
              className={`px-6 py-3 text-white rounded-lg ${
                config.analysisType === 'sender_frequency'
                  ? 'bg-teal-600 hover:bg-teal-700'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Review and Start */}
      {currentStep === 4 && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-semibold mb-4">Review Configuration</h2>

          <div className="space-y-4 mb-6">
            <div className="flex justify-between py-2 border-b">
              <span className="font-medium text-gray-900">Analysis Type:</span>
              <span className="text-gray-900">{config.description}</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="font-medium text-gray-900">Gmail Query:</span>
              <span className="text-gray-900 font-mono">{config.query || '(none)'}</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="font-medium text-gray-900">Email Limit:</span>
              <span className="text-gray-900">{config.limit} emails</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="font-medium text-gray-900">Analysis Mode:</span>
              <span className="capitalize text-gray-900">{config.mode}</span>
            </div>
          </div>

          <div className="flex space-x-3">
            <button
              onClick={() => setCurrentStep(3)}
              className="px-6 py-3 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Back
            </button>
            <button
              onClick={runAnalysis}
              disabled={isAnalyzing}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center space-x-2"
            >
              {isAnalyzing && (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              )}
              <span className="text-white">{isAnalyzing ? 'Analyzing...' : 'Start Analysis'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}