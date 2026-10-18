-- Alert frame images now live on disk (ALERT_IMAGES_DIR); only the file name is stored here.
-- Any existing images must be written out to files before this runs, since it drops the old
-- column (it fails outright on a non-empty Alert table rather than leaving rows without a file).
ALTER TABLE "Alert" DROP COLUMN "image",
ADD COLUMN     "imageFile" TEXT NOT NULL;
