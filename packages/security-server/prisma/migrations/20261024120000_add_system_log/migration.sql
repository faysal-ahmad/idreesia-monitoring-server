-- CreateEnum
CREATE TYPE "SystemLogEvent" AS ENUM ('CHANNEL_CREATED', 'CHANNEL_UPDATED', 'CHANNEL_DELETED', 'CHANNEL_ENABLED', 'CHANNEL_DISABLED');

-- CreateEnum
CREATE TYPE "SystemLogSource" AS ENUM ('ADMIN', 'SYSTEM');

-- CreateTable
CREATE TABLE "SystemLog" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event" "SystemLogEvent" NOT NULL,
    "source" "SystemLogSource" NOT NULL,
    "channelId" TEXT,
    "channelName" TEXT,
    "message" TEXT NOT NULL,

    CONSTRAINT "SystemLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SystemLog_timestamp_idx" ON "SystemLog"("timestamp");
