-- Extend the existing stamp ledger; preserve all existing cards and balances.
ALTER TABLE "LoyaltyCard" ADD COLUMN "rewardActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "LoyaltyStamp" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'EARN',
 ADD COLUMN "amount" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "sourceVisitId" TEXT,
 ADD COLUMN "sourceBookingId" TEXT,
 ADD COLUMN "rewardTitle" TEXT;
ALTER TABLE "LoyaltyStamp" ADD CONSTRAINT "LoyaltyStamp_value_check"
 CHECK (("kind" = 'EARN' AND "amount" = 1) OR ("kind" = 'REDEEM' AND "amount" < 0));
