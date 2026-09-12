CREATE TABLE "SalonArchive" (
    "archiveId" UUID NOT NULL,
    "salonId" TEXT NOT NULL,
    "salonName" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "archiveVersion" INTEGER NOT NULL DEFAULT 1,
    "payloadVersion" INTEGER NOT NULL DEFAULT 1,
    "coverage" JSONB NOT NULL,
    "sourceState" JSONB NOT NULL,
    "evidence" JSONB,
    "source" TEXT NOT NULL,
    "finalizedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalonArchive_pkey" PRIMARY KEY ("archiveId")
);

CREATE INDEX "SalonArchive_salonId_finalizedAt_idx"
ON "SalonArchive"("salonId", "finalizedAt");