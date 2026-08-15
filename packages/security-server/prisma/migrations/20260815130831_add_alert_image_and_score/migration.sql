/*
  Warnings:

  - Added the required column `image` to the `Alert` table without a default value. This is not possible if the table is not empty.
  - Added the required column `similarityScore` to the `Alert` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "image" BYTEA NOT NULL,
ADD COLUMN     "similarityScore" DOUBLE PRECISION NOT NULL;
