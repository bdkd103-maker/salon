-- Extend the existing password-reset table with short-lived email challenge metadata.
ALTER TABLE "PasswordReset"
  ADD COLUMN "codeDigest" TEXT,
  ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "deliveryState" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "providerMessageId" TEXT,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sendCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastSendAt" TIMESTAMP(3),
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "invalidatedAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "PasswordReset_userId_expiresAt_idx" ON "PasswordReset"("userId", "expiresAt");
CREATE INDEX "PasswordReset_expiresAt_idx" ON "PasswordReset"("expiresAt");
