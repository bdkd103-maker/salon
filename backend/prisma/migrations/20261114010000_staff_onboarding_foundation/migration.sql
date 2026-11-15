-- Additive foundation only. REVIEW before applying; never run automatically.
ALTER TABLE "User"
  ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "staffPasswordChangeRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD CONSTRAINT "User_authVersion_nonnegative" CHECK ("authVersion" >= 0);

-- The default preserves existing Customer reset challenges/proofs and their HMAC format.
ALTER TABLE "PasswordReset" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'CUSTOMER_PASSWORD_RESET';
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_purpose_check"
  CHECK ("purpose" IN ('CUSTOMER_PASSWORD_RESET', 'STAFF_PASSWORD_RESET'));

CREATE TYPE "StaffInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED');
CREATE TYPE "StaffInvitationDelivery" AS ENUM ('PENDING', 'ACCEPTED', 'FAILED', 'UNKNOWN');
CREATE TABLE "StaffInvitation" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "initiatedByUserId" TEXT NOT NULL,
  "destinationEmail" TEXT NOT NULL,
  "intendedUserId" TEXT,
  "fullName" TEXT NOT NULL,
  "phone" TEXT,
  "barberName" TEXT NOT NULL,
  "secretDigest" TEXT,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "status" "StaffInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "deliveryState" "StaffInvitationDelivery" NOT NULL DEFAULT 'PENDING',
  "providerMessageId" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "declinedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "acceptedByUserId" TEXT,
  "sendCount" INTEGER NOT NULL DEFAULT 0,
  "resendCount" INTEGER NOT NULL DEFAULT 0,
  "lastSendAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StaffInvitation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StaffInvitation_email_normalized" CHECK (
    "destinationEmail" = lower(btrim("destinationEmail")) AND length("destinationEmail") BETWEEN 3 AND 254
  ),
  CONSTRAINT "StaffInvitation_digest_format" CHECK ("secretDigest" IS NULL OR "secretDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "StaffInvitation_counters_check" CHECK ("generation" >= 1 AND "sendCount" >= 0 AND "resendCount" >= 0),
  CONSTRAINT "StaffInvitation_expiry_check" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "StaffInvitation_lifecycle_check" CHECK (
    ("status" = 'PENDING' AND "secretDigest" IS NOT NULL AND "acceptedAt" IS NULL AND "revokedAt" IS NULL AND "declinedAt" IS NULL AND "consumedAt" IS NULL)
    OR ("status" = 'ACCEPTED' AND "acceptedAt" IS NOT NULL AND "consumedAt" IS NOT NULL AND "secretDigest" IS NULL)
    OR ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL AND "secretDigest" IS NULL)
    OR ("status" = 'DECLINED' AND "declinedAt" IS NOT NULL AND "secretDigest" IS NULL)
    OR ("status" = 'EXPIRED' AND "secretDigest" IS NULL)
  )
);
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_intendedUserId_fkey" FOREIGN KEY ("intendedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Expired PENDING rows still occupy the slot until explicitly transitioned later.
-- Do not use now() in a partial-index predicate or a check-then-insert application lock.
CREATE UNIQUE INDEX "StaffInvitation_one_pending_per_salon_email_key"
  ON "StaffInvitation"("salonId", "destinationEmail") WHERE "status" = 'PENDING';
CREATE INDEX "StaffInvitation_salonId_status_idx" ON "StaffInvitation"("salonId", "status");
CREATE INDEX "StaffInvitation_destinationEmail_expiresAt_idx" ON "StaffInvitation"("destinationEmail", "expiresAt");
CREATE INDEX "StaffInvitation_initiatedByUserId_idx" ON "StaffInvitation"("initiatedByUserId");
CREATE INDEX "StaffInvitation_intendedUserId_idx" ON "StaffInvitation"("intendedUserId");
CREATE INDEX "StaffInvitation_acceptedByUserId_idx" ON "StaffInvitation"("acceptedByUserId");
