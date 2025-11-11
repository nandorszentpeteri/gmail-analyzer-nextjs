# Gmail Analyzer

A Next.js application that analyzes your Gmail inbox to identify deletion candidates, newsletter senders, and potential storage savings using AI-powered email classification.

## Features

- **Gmail Integration**: Securely connect to your Gmail account via Google OAuth
- **AI-Powered Analysis**: Uses Claude Sonnet 4 to intelligently categorize and analyze emails
- **Email Classification**: Identifies newsletters, promotional emails, and deletion candidates
- **Storage Insights**: Shows potential storage savings from cleaning up your inbox
- **Historical Reports**: Track and compare analysis results over time
- **Batch Processing**: Efficiently processes large volumes of emails

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS
- **Backend**: Next.js API routes, Prisma ORM
- **Database**: SQLite (easily configurable for other databases)
- **Authentication**: NextAuth.js with Google OAuth
- **AI**: AWS Bedrock with Claude Sonnet 4
- **Email API**: Gmail API via Google APIs

## Prerequisites

- Node.js 18+
- Google Cloud Project with Gmail API enabled
- AWS account with Bedrock access
- Google OAuth credentials

## Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd gmail-analyzer-nextjs
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**

   Copy `.env.local.example` to `.env.local` and fill in the required values:
   ```bash
   cp .env.local.example .env.local
   ```

   Required environment variables:
   - `GOOGLE_CLIENT_ID` - Google OAuth client ID
   - `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
   - `AWS_REGION` - AWS region for Bedrock
   - `AWS_PROFILE` - AWS profile with Bedrock access
   - `NEXTAUTH_SECRET` - Random secret for NextAuth
   - `NEXTAUTH_URL` - Your application URL
   - `DATABASE_URL` - Database connection string

4. **Run the development server**
   ```bash
   npm run dev
   ```

   The database will be automatically set up on first run, including:
   - Database creation (if needed)
   - Prisma client generation
   - Schema migrations

   Open [http://localhost:3000](http://localhost:3000) in your browser.

## Google OAuth Setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Gmail API
4. Create OAuth 2.0 credentials
5. Add your domain to authorized origins
6. Add the callback URL: `http://localhost:3000/api/auth/callback/google`

## AWS Bedrock Setup

1. Ensure you have AWS CLI configured with appropriate credentials
2. Request access to Claude models in AWS Bedrock console
3. Configure your AWS profile with the necessary permissions

## Usage

1. **Sign In**: Use Google OAuth to connect your Gmail account
2. **Analyze**: Start an analysis of your inbox with customizable parameters
3. **Review Results**: Browse deletion candidates and newsletter senders
4. **Track Progress**: View historical reports and storage savings

## Available Scripts

- `npm run dev` - Start development server with Turbopack (auto-setup database)
- `npm run build` - Build for production (auto-setup database)
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run db:setup` - Manually set up database and generate client
- `npm run db:generate` - Generate Prisma client
- `npm run db:push` - Push schema changes to database
- `npm run db:migrate` - Run database migrations

## Project Structure

```
src/
├── app/                 # Next.js app router pages
│   ├── analyze/        # Email analysis interface
│   ├── reports/        # Historical reports
│   └── results/        # Analysis results
├── lib/                # Utility libraries
└── components/         # React components
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Security

This application handles sensitive email data. Key security measures:

- OAuth 2.0 for secure Gmail access
- Environment variables for sensitive configuration
- Data stored locally in SQLite database
- No email content stored permanently
- Secure AWS Bedrock integration

Never commit `.env` files or expose API keys in your code.