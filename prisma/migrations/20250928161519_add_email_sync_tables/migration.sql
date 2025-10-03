-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userEmail" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "limit" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "totalEmails" INTEGER NOT NULL,
    "deletionCandidates" INTEGER NOT NULL,
    "newsletterSenders" INTEGER NOT NULL,
    "totalSize" BIGINT NOT NULL,
    "potentialSavings" BIGINT NOT NULL,
    CONSTRAINT "reports_userEmail_fkey" FOREIGN KEY ("userEmail") REFERENCES "users" ("email") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "email_candidates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "category" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_candidates_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "newsletter_senders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "totalSize" BIGINT NOT NULL,
    "category" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "newsletter_senders_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "emails" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userEmail" TEXT NOT NULL,
    "gmailId" TEXT NOT NULL,
    "threadId" TEXT,
    "subject" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "toAddress" TEXT,
    "date" DATETIME NOT NULL,
    "size" INTEGER NOT NULL,
    "labels" TEXT NOT NULL,
    "snippet" TEXT,
    "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "attachmentInfo" TEXT,
    "category" TEXT,
    "lastSynced" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "emails_userEmail_fkey" FOREIGN KEY ("userEmail") REFERENCES "users" ("email") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sync_status" (
    "userEmail" TEXT NOT NULL PRIMARY KEY,
    "lastSync" DATETIME,
    "totalEmails" INTEGER NOT NULL DEFAULT 0,
    "syncInProgress" BOOLEAN NOT NULL DEFAULT false,
    "syncOptions" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "sync_status_userEmail_fkey" FOREIGN KEY ("userEmail") REFERENCES "users" ("email") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "emails_gmailId_key" ON "emails"("gmailId");

-- CreateIndex
CREATE INDEX "emails_userEmail_idx" ON "emails"("userEmail");

-- CreateIndex
CREATE INDEX "emails_gmailId_idx" ON "emails"("gmailId");

-- CreateIndex
CREATE INDEX "emails_date_idx" ON "emails"("date");

-- CreateIndex
CREATE INDEX "emails_senderEmail_idx" ON "emails"("senderEmail");

-- CreateIndex
CREATE INDEX "emails_category_idx" ON "emails"("category");
