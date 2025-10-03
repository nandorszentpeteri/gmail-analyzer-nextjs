import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'

export async function middleware(request: NextRequest) {
  // Only apply to API routes that need authentication
  const protectedPaths = ['/api/sync', '/api/analyze', '/api/reports']
  const isProtectedPath = protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))

  if (!isProtectedPath) {
    return NextResponse.next()
  }

  try {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET
    })

    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      )
    }

    // Check if token is expired and needs refresh
    const now = Date.now()
    const tokenExpiration = (token.accessTokenExpires as number) * 1000

    if (now >= tokenExpiration) {
      console.log('Token expired, attempting refresh...')

      try {
        const refreshedToken = await refreshAccessToken(token)

        if (refreshedToken.error) {
          console.error('Token refresh failed:', refreshedToken.error)
          return NextResponse.json({
            error: 'Authentication expired - Please sign out and sign in again',
            requiresReauth: true
          }, { status: 401 })
        }

        // Token refreshed successfully - continue with request
        console.log('Token refreshed successfully')
      } catch (error) {
        console.error('Token refresh error:', error)
        return NextResponse.json({
          error: 'Authentication expired - Please sign out and sign in again',
          requiresReauth: true
        }, { status: 401 })
      }
    }

    // Continue with the request
    return NextResponse.next()

  } catch (error) {
    console.error('Middleware error:', error)
    return NextResponse.json(
      { error: 'Authentication error' },
      { status: 401 }
    )
  }
}

async function refreshAccessToken(token: any) {
  try {
    const url = 'https://oauth2.googleapis.com/token'

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
      }),
    })

    const refreshedTokens = await response.json()

    if (!response.ok) {
      throw refreshedTokens
    }

    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      accessTokenExpires: Date.now() + refreshedTokens.expires_in * 1000,
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
    }
  } catch (error) {
    console.error('Token refresh failed:', error)
    return {
      ...token,
      error: 'RefreshAccessTokenError',
    }
  }
}

export const config = {
  matcher: ['/api/:path*']
}