/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    AWS_PROFILE: process.env.AWS_PROFILE,
    AWS_REGION: process.env.AWS_REGION,
    CLAUDE_MODEL_ID: process.env.CLAUDE_MODEL_ID,
  },
  experimental: {
    serverComponentsExternalPackages: ['@aws-sdk/client-bedrock-runtime']
  }
}

module.exports = nextConfig