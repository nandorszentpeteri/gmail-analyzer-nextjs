import { promises as fs } from 'fs'
import path from 'path'
import { migrateFileReport } from '../src/lib/database'

const REPORTS_DIR = path.join(process.cwd(), 'data', 'reports')

async function migrateExistingReports() {
  try {
    console.log('🔄 Starting migration of file-based reports to database...')

    // Check if reports directory exists
    try {
      await fs.access(REPORTS_DIR)
    } catch {
      console.log('📁 No reports directory found, nothing to migrate')
      return
    }

    const files = await fs.readdir(REPORTS_DIR)
    const reportFiles = files.filter(file => file.endsWith('.json'))

    if (reportFiles.length === 0) {
      console.log('📁 No report files found, nothing to migrate')
      return
    }

    console.log(`📊 Found ${reportFiles.length} report files to migrate`)

    let successCount = 0
    let errorCount = 0

    for (const file of reportFiles) {
      try {
        console.log(`\n📄 Processing ${file}...`)

        const reportPath = path.join(REPORTS_DIR, file)
        const reportData = await fs.readFile(reportPath, 'utf-8')
        const report = JSON.parse(reportData)

        // Migrate to database
        const dbReport = await migrateFileReport(report)

        console.log(`✅ Migrated report: ${dbReport.description} (ID: ${dbReport.id})`)
        successCount++

        // Optionally backup the original file
        const backupPath = path.join(REPORTS_DIR, 'migrated', file)
        await fs.mkdir(path.dirname(backupPath), { recursive: true })
        await fs.rename(reportPath, backupPath)
        console.log(`📦 Backed up original to: migrated/${file}`)

      } catch (error) {
        console.error(`❌ Error migrating ${file}:`, error)
        errorCount++
      }
    }

    console.log(`\n🎉 Migration complete!`)
    console.log(`✅ Successfully migrated: ${successCount} reports`)
    console.log(`❌ Errors: ${errorCount} reports`)

    if (successCount > 0) {
      console.log(`📦 Original files backed up to: ${path.join(REPORTS_DIR, 'migrated')}`)
    }

  } catch (error) {
    console.error('💥 Migration failed:', error)
    process.exit(1)
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  migrateExistingReports().then(() => {
    console.log('✨ Migration script completed')
    process.exit(0)
  }).catch((error) => {
    console.error('💥 Migration script failed:', error)
    process.exit(1)
  })
}

export { migrateExistingReports }