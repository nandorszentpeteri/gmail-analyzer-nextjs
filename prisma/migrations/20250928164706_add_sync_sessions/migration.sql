-- CreateTable
CREATE TABLE "sync_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userEmail" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "status" TEXT NOT NULL,
    "syncOptions" TEXT NOT NULL,
    "dateRangeStart" DATETIME,
    "dateRangeEnd" DATETIME,
    "emailsProcessed" INTEGER NOT NULL DEFAULT 0,
    "totalEmails" INTEGER,
    "currentBatch" INTEGER NOT NULL DEFAULT 0,
    "totalBatches" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "sync_sessions_userEmail_fkey" FOREIGN KEY ("userEmail") REFERENCES "users" ("email") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "sync_sessions_userEmail_idx" ON "sync_sessions"("userEmail");

-- CreateIndex
CREATE INDEX "sync_sessions_status_idx" ON "sync_sessions"("status");
