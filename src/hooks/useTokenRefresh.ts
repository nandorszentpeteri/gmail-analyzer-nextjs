import { useSession } from 'next-auth/react'
import { useEffect, useCallback } from 'react'

export function useTokenRefresh() {
  const { data: session, update } = useSession()

  const refreshTokenIfNeeded = useCallback(async () => {
    if (!session?.accessToken) return

    try {
      // Force NextAuth to check and refresh the token
      await update()
    } catch (error) {
      console.error('Token refresh failed:', error)
    }
  }, [session, update])

  // Auto-refresh token when it's close to expiring
  useEffect(() => {
    if (!session) return

    const checkTokenExpiration = () => {
      // Check if token expires in the next 5 minutes
      const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000
      const tokenExpires = (session as any).accessTokenExpires * 1000

      if (tokenExpires && tokenExpires < fiveMinutesFromNow) {
        console.log('Token expiring soon, refreshing...')
        refreshTokenIfNeeded()
      }
    }

    // Check immediately and then every 2 minutes
    checkTokenExpiration()
    const interval = setInterval(checkTokenExpiration, 2 * 60 * 1000)

    return () => clearInterval(interval)
  }, [session, refreshTokenIfNeeded])

  return { refreshTokenIfNeeded }
}