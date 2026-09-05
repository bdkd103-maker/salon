-- Empty days and NULL timezone mean unconfirmed schedule metadata.
ALTER TABLE "Salon"
ADD COLUMN "workingDays" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "timeZone" TEXT;
