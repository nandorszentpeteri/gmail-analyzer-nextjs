-- AlterTable
ALTER TABLE "reports" ADD COLUMN "aiRequestCount" INTEGER DEFAULT 0;
ALTER TABLE "reports" ADD COLUMN "tokenInputCount" INTEGER DEFAULT 0;
ALTER TABLE "reports" ADD COLUMN "tokenOutputCount" INTEGER DEFAULT 0;
ALTER TABLE "reports" ADD COLUMN "tokenTotalCount" INTEGER DEFAULT 0;
