-- AlterTable
ALTER TABLE "ErpSyncState" ADD COLUMN     "lastUsageStatsPushError" TEXT,
ADD COLUMN     "usageStatsPushedUntil" TIMESTAMP(3);
