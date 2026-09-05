-- CreateEnum
CREATE TYPE "SalonClassification" AS ENUM ('REGULAR', 'PREMIUM');

-- AlterTable
ALTER TABLE "Salon"
ADD COLUMN "adminVip" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "classification" "SalonClassification" NOT NULL DEFAULT 'REGULAR';

-- Migrate legacy VIP selections into the new manual-admin VIP field.
UPDATE "Salon"
SET "adminVip" = COALESCE("isVip", false)
WHERE "adminVip" = false;
