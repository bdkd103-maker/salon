CREATE TABLE "SalonEnforcement" (
    "id" UUID NOT NULL,
    "salonId" TEXT NOT NULL,
    "salonName" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "enforcedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousIsActive" BOOLEAN NOT NULL,
    "subscription" JSONB,

    CONSTRAINT "SalonEnforcement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SalonEnforcement_salonId_enforcedAt_idx"
    ON "SalonEnforcement"("salonId", "enforcedAt");
