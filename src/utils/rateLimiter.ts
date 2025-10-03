interface RateLimiterConfig {
  maxRequests: number    // Max requests per window
  windowMs: number       // Time window in milliseconds
  minDelayMs: number     // Minimum delay between requests
}

export class RateLimiter {
  private requests: number[] = []
  private config: RateLimiterConfig

  constructor(config: RateLimiterConfig) {
    this.config = config
  }

  async waitIfNeeded(): Promise<void> {
    const now = Date.now()

    // Remove old requests outside the window
    this.requests = this.requests.filter(time => now - time < this.config.windowMs)

    // Check if we're at the limit
    if (this.requests.length >= this.config.maxRequests) {
      const oldestRequest = Math.min(...this.requests)
      const waitTime = this.config.windowMs - (now - oldestRequest) + 100 // Add 100ms buffer

      if (waitTime > 0) {
        console.log(`Rate limit reached, waiting ${Math.round(waitTime/1000)}s...`)
        await this.sleep(waitTime)
      }
    }

    // Ensure minimum delay between requests
    if (this.requests.length > 0) {
      const lastRequest = Math.max(...this.requests)
      const timeSinceLastRequest = now - lastRequest

      if (timeSinceLastRequest < this.config.minDelayMs) {
        const delayNeeded = this.config.minDelayMs - timeSinceLastRequest
        await this.sleep(delayNeeded)
      }
    }

    // Record this request
    this.requests.push(Date.now())
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  getStatus(): { requestsInWindow: number; maxRequests: number } {
    const now = Date.now()
    const recentRequests = this.requests.filter(time => now - time < this.config.windowMs)

    return {
      requestsInWindow: recentRequests.length,
      maxRequests: this.config.maxRequests
    }
  }
}

// Gmail API rate limiter - 7.5k requests/minute (50% of 15k limit for safety)
// Shared across all Gmail API operations to prevent quota exceeded
export const gmailRateLimiter = new RateLimiter({
  maxRequests: 7500,     // 7.5k requests per minute
  windowMs: 60 * 1000,   // 1 minute window
  minDelayMs: 8          // 8ms between requests (7.5k/min = 125/sec = 8ms interval)
})

// Use the same rate limiter for batch operations
export const gmailBatchRateLimiter = gmailRateLimiter