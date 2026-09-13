CREATE TABLE "SalonRetentionHold" (
    "id" UUID NOT NULL,
    "salonId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releasedByUserId" TEXT,
    "releaseReason" TEXT,
    CONSTRAINT "SalonRetentionHold_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SalonRetentionHold_salonId_releasedAt_idx" ON "SalonRetentionHold"("salonId", "releasedAt");

CREATE TABLE "SalonPurgeClearance" (
    "id" UUID NOT NULL,
    "salonId" TEXT NOT NULL,
    "archiveId" UUID NOT NULL,
    "archiveVersion" INTEGER NOT NULL,
    "payloadVersion" INTEGER NOT NULL,
    "archiveFinalizedAt" TIMESTAMP(3) NOT NULL,
    "sourceState" JSONB NOT NULL,
    "coverage" JSONB NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revocationReason" TEXT,
    CONSTRAINT "SalonPurgeClearance_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SalonPurgeClearance_salonId_revokedAt_idx" ON "SalonPurgeClearance"("salonId", "revokedAt");
CREATE INDEX "SalonPurgeClearance_archiveId_idx" ON "SalonPurgeClearance"("archiveId");
