-- CreateTable
CREATE TABLE "ChannelStats" (
    "id" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "channelId" TEXT NOT NULL,
    "frameWidth" INTEGER,
    "frameHeight" INTEGER,
    "framesRead" INTEGER NOT NULL,
    "framesProcessed" INTEGER NOT NULL,
    "skippedFps" INTEGER NOT NULL,
    "skippedBusy" INTEGER NOT NULL,
    "readFailures" INTEGER NOT NULL,
    "reconnects" INTEGER NOT NULL,
    "faces" INTEGER NOT NULL,
    "inferenceMs" DOUBLE PRECISION NOT NULL,
    "detectAvgMs" DOUBLE PRECISION,
    "embedAvgMs" DOUBLE PRECISION,

    CONSTRAINT "ChannelStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerStats" (
    "id" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "activeChannels" INTEGER NOT NULL,
    "dnnTarget" TEXT NOT NULL,
    "inferenceBusyPct" DOUBLE PRECISION NOT NULL,
    "gpuUtilAvgPct" DOUBLE PRECISION,
    "gpuUtilMaxPct" DOUBLE PRECISION,
    "gpuMemUsedMb" INTEGER,
    "gpuMemTotalMb" INTEGER,
    "cpuPct" DOUBLE PRECISION NOT NULL,
    "cpuCores" INTEGER NOT NULL,
    "eventLoopLagP95Ms" DOUBLE PRECISION NOT NULL,
    "eventLoopLagMaxMs" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ServerStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelStats_channelId_windowStart_idx" ON "ChannelStats"("channelId", "windowStart");

-- CreateIndex
CREATE INDEX "ChannelStats_windowStart_idx" ON "ChannelStats"("windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "ServerStats_windowStart_key" ON "ServerStats"("windowStart");

-- AddForeignKey
ALTER TABLE "ChannelStats" ADD CONSTRAINT "ChannelStats_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "VideoFeedSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
