-- CreateTable
CREATE TABLE "Channel" (
    "channelId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("channelId")
);

-- CreateTable
CREATE TABLE "Streamer" (
    "streamerId" TEXT NOT NULL,
    "name" TEXT,
    "twitchName" TEXT NOT NULL,

    CONSTRAINT "Streamer_pkey" PRIMARY KEY ("streamerId")
);
