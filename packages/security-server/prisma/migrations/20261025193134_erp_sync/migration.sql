/*
  Warnings:

  - You are about to drop the column `review` on the `Alert` table. All the data in the column will be lost.
  - You are about to drop the column `reviewedAt` on the `Alert` table. All the data in the column will be lost.
  - You are about to drop the `SystemLog` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "ErpSyncStatus" AS ENUM ('PENDING', 'SENT');

-- AlterTable
ALTER TABLE "Alert" DROP COLUMN "review",
DROP COLUMN "reviewedAt",
ADD COLUMN     "erpSyncError" TEXT,
ADD COLUMN     "erpSyncStatus" "ErpSyncStatus" NOT NULL DEFAULT 'PENDING';

-- DropTable
DROP TABLE "SystemLog";

-- DropEnum
DROP TYPE "AlertReview";

-- DropEnum
DROP TYPE "SystemLogEvent";

-- DropEnum
DROP TYPE "SystemLogSource";

-- AlterTable
ALTER TABLE "VideoFeedSource" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "externalId" TEXT;

-- AlterTable
ALTER TABLE "MonitoringProfile" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "externalId" TEXT;

-- AlterTable
ALTER TABLE "MonitoringProfileImage" ADD COLUMN     "externalId" TEXT,
ALTER COLUMN "embedding" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ErpSyncState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "pullCursor" TEXT,
    "lastSyncStartedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Alert_erpSyncStatus_timestamp_idx" ON "Alert"("erpSyncStatus", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "VideoFeedSource_externalId_key" ON "VideoFeedSource"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringProfile_externalId_key" ON "MonitoringProfile"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringProfileImage_externalId_key" ON "MonitoringProfileImage"("externalId");
