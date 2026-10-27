-- USB channels are no longer supported — every camera is RTSP. Remove any USB channel first (the
-- seeded "Default webcam"); one with alert history makes this fail via the Alert FK rather than
-- silently dropping that history.
DELETE FROM "VideoFeedSource" WHERE "type" = 'USB';

-- AlterTable
ALTER TABLE "VideoFeedSource" DROP COLUMN "removable",
DROP COLUMN "type";

-- DropEnum
DROP TYPE "VideoFeedSourceType";
