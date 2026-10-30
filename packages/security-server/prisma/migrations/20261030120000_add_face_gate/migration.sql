-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "faceQuality" JSONB,
ADD COLUMN     "faceSizePx" INTEGER;

-- AlterTable
ALTER TABLE "ChannelStats" ADD COLUMN     "skippedFaceQuality" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "skippedFaceSize" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "VideoFeedSource" ADD COLUMN     "minFaceQuality" INTEGER,
ADD COLUMN     "minFaceSizePx" INTEGER;
