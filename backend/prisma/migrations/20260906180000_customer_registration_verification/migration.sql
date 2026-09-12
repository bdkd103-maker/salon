-- Additive only: no existing users, numbers or tables are changed.
CREATE TABLE "RegistrationVerificationChallenge" (
  "id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "destination" TEXT NOT NULL,
  "codeDigest" TEXT,
  "generation" INTEGER NOT NULL,
  "deliveryState" TEXT NOT NULL,
  "providerMessageId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "sendCount" INTEGER NOT NULL DEFAULT 0,
  "lastSendAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "registrationTokenHash" TEXT,
  "registrationTokenExpiresAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RegistrationVerificationChallenge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RegistrationVerificationChallenge_destination_purpose_idx" ON "RegistrationVerificationChallenge"("destination", "purpose");
CREATE INDEX "RegistrationVerificationChallenge_expiresAt_idx" ON "RegistrationVerificationChallenge"("expiresAt");
CREATE TABLE "VerificationRateLimitBucket" (
  "id" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VerificationRateLimitBucket_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VerificationRateLimitBucket_expiresAt_idx" ON "VerificationRateLimitBucket"("expiresAt");
