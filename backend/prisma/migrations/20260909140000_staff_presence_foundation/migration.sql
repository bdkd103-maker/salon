-- CreateEnum
CREATE TYPE "StaffDutyState" AS ENUM ('ON_DUTY', 'OFF_DUTY');

-- CreateEnum
CREATE TYPE "StaffPresenceChangeSource" AS ENUM ('STAFF', 'OWNER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "StaffPresenceEvidenceSource" AS ENUM ('STAFF_APP', 'OWNER', 'SALO_STATION', 'SERVICE_EVENT');

-- CreateTable
CREATE TABLE "StaffPresence" (
    "staffMembershipId" TEXT NOT NULL,
    "dutyState" "StaffDutyState" NOT NULL,
    "generation" INTEGER NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL,
    "changedByUserId" TEXT,
    "changeSource" "StaffPresenceChangeSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffPresence_pkey" PRIMARY KEY ("staffMembershipId")
);

-- CreateTable
CREATE TABLE "StaffPresenceLease" (
    "id" TEXT NOT NULL,
    "staffMembershipId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "evidenceSource" "StaffPresenceEvidenceSource" NOT NULL,
    "producerKey" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffPresenceLease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffPresence_changedByUserId_idx" ON "StaffPresence"("changedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffPresenceLease_staffMembershipId_evidenceSource_producerKey_key" ON "StaffPresenceLease"("staffMembershipId", "evidenceSource", "producerKey");

-- CreateIndex
CREATE INDEX "StaffPresenceLease_staffMembershipId_generation_validUntil_idx" ON "StaffPresenceLease"("staffMembershipId", "generation", "validUntil");

-- AddForeignKey
ALTER TABLE "StaffPresence" ADD CONSTRAINT "StaffPresence_staffMembershipId_fkey" FOREIGN KEY ("staffMembershipId") REFERENCES "StaffMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPresence" ADD CONSTRAINT "StaffPresence_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPresenceLease" ADD CONSTRAINT "StaffPresenceLease_staffMembershipId_fkey" FOREIGN KEY ("staffMembershipId") REFERENCES "StaffPresence"("staffMembershipId") ON DELETE CASCADE ON UPDATE CASCADE;