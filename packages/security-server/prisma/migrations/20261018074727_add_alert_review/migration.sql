-- CreateEnum
CREATE TYPE "AlertReview" AS ENUM ('CORRECT', 'FALSE_POSITIVE');

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "review" "AlertReview",
ADD COLUMN     "reviewedAt" TIMESTAMP(3);
