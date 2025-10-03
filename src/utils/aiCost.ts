/**
 * AI Cost Calculation Utilities
 *
 * Centralized pricing and cost calculations for AWS Bedrock Claude models
 */

// AWS Bedrock Claude 4 Sonnet pricing (as of 2024)
// Source: https://aws.amazon.com/bedrock/pricing/
export const CLAUDE_PRICING = {
  // Claude 4 Sonnet: $3.00 per 1M input tokens, $15.00 per 1M output tokens (≤200K context)
  INPUT_COST_PER_1M: 3.00,
  OUTPUT_COST_PER_1M: 15.00,
} as const

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  requestCount?: number
}

export interface CostBreakdown {
  inputCost: number
  outputCost: number
  totalCost: number
  formatted: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/**
 * Calculate AI cost based on token usage
 */
export function calculateAICost(tokenUsage: TokenUsage): CostBreakdown {
  const inputCost = (tokenUsage.inputTokens / 1_000_000) * CLAUDE_PRICING.INPUT_COST_PER_1M
  const outputCost = (tokenUsage.outputTokens / 1_000_000) * CLAUDE_PRICING.OUTPUT_COST_PER_1M
  const totalCost = inputCost + outputCost

  return {
    inputCost,
    outputCost,
    totalCost,
    formatted: formatCost(totalCost),
    inputTokens: tokenUsage.inputTokens,
    outputTokens: tokenUsage.outputTokens,
    totalTokens: tokenUsage.totalTokens,
  }
}

/**
 * Format cost as currency string
 */
export function formatCost(cost: number): string {
  if (cost < 0.001) {
    return '<$0.001'
  }
  return `$${cost.toFixed(3)}`
}

/**
 * Format token count with proper locale formatting
 */
export function formatTokenCount(tokens: number): string {
  return tokens.toLocaleString()
}

/**
 * Calculate cost from individual token counts (for backward compatibility)
 */
export function calculateCostFromTokens(
  inputTokens: number = 0,
  outputTokens: number = 0
): CostBreakdown {
  return calculateAICost({
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  })
}