-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "security_server";

-- CreateEnum
CREATE TYPE "VideoFeedSourceType" AS ENUM ('RTSP', 'USB');

-- CreateTable
CREATE TABLE "VideoFeedSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "VideoFeedSourceType" NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "removable" BOOLEAN NOT NULL DEFAULT true,
    "similarityThreshold" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoFeedSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoringProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringProfileImage" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "image" BYTEA NOT NULL,
    "embedding" vector(128) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringProfileImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "monitoringProfileId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MonitoringProfileImage" ADD CONSTRAINT "MonitoringProfileImage_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "MonitoringProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_monitoringProfileId_fkey" FOREIGN KEY ("monitoringProfileId") REFERENCES "MonitoringProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "VideoFeedSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
