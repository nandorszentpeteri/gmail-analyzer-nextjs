#!/usr/bin/env tsx

import { exec } from 'child_process'
import { promisify } from 'util'
import { access, mkdir, stat } from 'fs/promises'
import path from 'path'

const execAsync = promisify(exec)

async function needsClientGeneration(): Promise<boolean> {
  try {
    const clientPath = path.join(process.cwd(), 'node_modules', '.prisma', 'client')
    const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma')

    // Check if client exists
    await access(clientPath)

    // Check if schema is newer than generated client
    const [clientStat, schemaStat] = await Promise.all([
      stat(clientPath),
      stat(schemaPath)
    ])

    return schemaStat.mtime > clientStat.mtime
  } catch {
    // Client doesn't exist or other error
    return true
  }
}

async function needsMigration(): Promise<boolean> {
  try {
    const { stdout } = await execAsync('npx prisma migrate status', { stdio: 'pipe' })
    // If status contains "Database schema is up to date", no migration needed
    return !stdout.includes('Database schema is up to date')
  } catch {
    // If migrate status fails, we probably need to set up the database
    return true
  }
}

async function ensureDatabase() {
  try {
    console.log('🔧 Checking database and client status...')

    // Ensure prisma directory exists
    const prismaDir = path.join(process.cwd(), 'prisma')
    try {
      await access(prismaDir)
    } catch {
      console.log('📁 Creating prisma directory...')
      await mkdir(prismaDir, { recursive: true })
    }

    // Check if Prisma client needs generation
    const clientNeeded = await needsClientGeneration()
    if (clientNeeded) {
      console.log('🔄 Generating Prisma client...')
      try {
        await execAsync('npx prisma generate')
        console.log('✅ Prisma client generated successfully')
      } catch (error) {
        console.error('❌ Failed to generate Prisma client:', error)
        throw error
      }
    } else {
      console.log('✅ Prisma client is up to date')
    }

    // Check if database needs migration
    const migrationNeeded = await needsMigration()
    if (migrationNeeded) {
      console.log('🔄 Database needs migration, running migrations...')
      try {
        await execAsync('npx prisma migrate deploy')
        console.log('✅ Database migrations completed')
      } catch (error) {
        // If migrate deploy fails (e.g., no migrations directory), try db push
        console.log('⚠️  Migrate deploy failed, trying db push...')
        try {
          await execAsync('npx prisma db push')
          console.log('✅ Database schema pushed successfully')
        } catch (pushError) {
          console.error('❌ Failed to setup database schema:', pushError)
          throw pushError
        }
      }
    } else {
      console.log('✅ Database schema is up to date')
    }

    // Only verify connection if we made changes
    if (clientNeeded || migrationNeeded) {
      console.log('🔍 Verifying database connection...')
      try {
        const { PrismaClient } = require('@prisma/client')
        const prisma = new PrismaClient()
        await prisma.$connect()
        await prisma.$disconnect()
        console.log('✅ Database connection verified')
      } catch (error) {
        console.error('❌ Database connection failed:', error)
        throw error
      }
    }

    if (!clientNeeded && !migrationNeeded) {
      console.log('✅ Database and client are already set up')
    } else {
      console.log('🎉 Database setup completed successfully!')
    }

  } catch (error) {
    console.error('💥 Database setup failed:', error)
    process.exit(1)
  }
}

// Run setup if this file is executed directly
if (require.main === module) {
  ensureDatabase().then(() => {
    console.log('✨ Setup script completed')
    process.exit(0)
  }).catch((error) => {
    console.error('💥 Setup script failed:', error)
    process.exit(1)
  })
}

export { ensureDatabase }