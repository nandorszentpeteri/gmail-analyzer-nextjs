-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_email_candidates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "category" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "recommendationType" TEXT NOT NULL DEFAULT 'delete',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_candidates_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_email_candidates" ("category", "createdAt", "date", "emailId", "from", "id", "reasoning", "reportId", "size", "subject") SELECT "category", "createdAt", "date", "emailId", "from", "id", "reasoning", "reportId", "size", "subject" FROM "email_candidates";
DROP TABLE "email_candidates";
ALTER TABLE "new_email_candidates" RENAME TO "email_candidates";
CREATE TABLE "new_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userEmail" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "limit" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "totalEmails" INTEGER NOT NULL,
    "deletionCandidates" INTEGER NOT NULL,
    "keepCandidates" INTEGER NOT NULL DEFAULT 0,
    "newsletterSenders" INTEGER NOT NULL,
    "totalSize" BIGINT NOT NULL,
    "potentialSavings" BIGINT NOT NULL,
    "tokenInputCount" INTEGER DEFAULT 0,
    "tokenOutputCount" INTEGER DEFAULT 0,
    "tokenTotalCount" INTEGER DEFAULT 0,
    "aiRequestCount" INTEGER DEFAULT 0,
    CONSTRAINT "reports_userEmail_fkey" FOREIGN KEY ("userEmail") REFERENCES "users" ("email") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_reports" ("aiRequestCount", "createdAt", "deletionCandidates", "description", "id", "limit", "mode", "newsletterSenders", "potentialSavings", "tokenInputCount", "tokenOutputCount", "tokenTotalCount", "totalEmails", "totalSize", "updatedAt", "userEmail") SELECT "aiRequestCount", "createdAt", "deletionCandidates", "description", "id", "limit", "mode", "newsletterSenders", "potentialSavings", "tokenInputCount", "tokenOutputCount", "tokenTotalCount", "totalEmails", "totalSize", "updatedAt", "userEmail" FROM "reports";
DROP TABLE "reports";
ALTER TABLE "new_reports" RENAME TO "reports";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
