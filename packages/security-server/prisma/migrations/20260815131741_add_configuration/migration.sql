-- CreateTable
CREATE TABLE "Configuration" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "alertsRetentionDays" INTEGER NOT NULL DEFAULT 7,

    CONSTRAINT "Configuration_pkey" PRIMARY KEY ("id")
);
