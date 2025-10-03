import { getSession, signOut } from 'next-auth/react'

interface ApiOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
}

class ApiClient {
  async request(url: string, options: ApiOptions = {}) {
    const session = await getSession()

    if (!session) {
      throw new Error('No session found')
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    })

    // If we get a 401 with requiresReauth, try to refresh the session first
    if (response.status === 401) {
      const errorData = await response.json().catch(() => ({}))

      if (errorData.requiresReauth) {
        console.log('Authentication required - attempting session refresh...')

        try {
          // Try to refresh the session
          const refreshedSession = await getSession()

          if (refreshedSession && refreshedSession !== session) {
            console.log('Session refreshed, retrying request...')

            // Retry the original request with refreshed session
            const retryResponse = await fetch(url, {
              ...options,
              headers: {
                'Content-Type': 'application/json',
                ...options.headers
              }
            })

            if (retryResponse.ok) {
              return retryResponse
            }
          }
        } catch (refreshError) {
          console.error('Session refresh failed:', refreshError)
        }

        // If refresh failed or didn't help, prompt user to re-authenticate
        if (confirm('Your authentication has expired. Sign out and sign in again to continue?')) {
          signOut()
        }
        throw new Error('Authentication expired')
      }
    }

    return response
  }

  async get(url: string) {
    return this.request(url, { method: 'GET' })
  }

  async post(url: string, data?: any) {
    return this.request(url, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined
    })
  }

  async delete(url: string) {
    return this.request(url, { method: 'DELETE' })
  }
}

export const apiClient = new ApiClient()