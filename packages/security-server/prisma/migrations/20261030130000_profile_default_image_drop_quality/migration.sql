-- AlterTable
ALTER TABLE "MonitoringProfile" ADD COLUMN     "defaultImageId" TEXT;

-- AlterTable
ALTER TABLE "MonitoringProfileImage" DROP COLUMN "quality";

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringProfile_defaultImageId_key" ON "MonitoringProfile"("defaultImageId");

-- AddForeignKey
ALTER TABLE "MonitoringProfile" ADD CONSTRAINT "MonitoringProfile_defaultImageId_fkey" FOREIGN KEY ("defaultImageId") REFERENCES "MonitoringProfileImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
