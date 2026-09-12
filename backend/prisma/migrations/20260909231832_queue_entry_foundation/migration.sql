-- CreateEnum
CREATE TYPE "QueueEntrySource" AS ENUM ('SALO_TICKET', 'MANUAL_WALK_IN');

-- CreateEnum
CREATE TYPE "QueueEntryStatus" AS ENUM ('WAITING', 'CALLED', 'STARTED', 'CANCELLED', 'EXPIRED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "QueueEntry" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "customerId" TEXT,
    "serviceVisitId" TEXT,
    "source" "QueueEntrySource" NOT NULL,
    "status" "QueueEntryStatus" NOT NULL DEFAULT 'WAITING',
    "joinedAt" TIMESTAMP(3) NOT NULL,
    "calledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "noShowAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QueueEntry_serviceVisitId_key" ON "QueueEntry"("serviceVisitId");

-- CreateIndex
CREATE INDEX "QueueEntry_salonId_status_joinedAt_idx" ON "QueueEntry"("salonId", "status", "joinedAt");

-- CreateIndex
CREATE INDEX "QueueEntry_customerId_status_idx" ON "QueueEntry"("customerId", "status");

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "QueueEntry"
ADD CONSTRAINT "QueueEntry_serviceVisitId_fkey"
FOREIGN KEY ("serviceVisitId")
REFERENCES "ServiceVisit"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Queue source/customer invariant
ALTER TABLE "QueueEntry"
ADD CONSTRAINT "QueueEntry_source_customer_check"
CHECK (
  ("source" = 'SALO_TICKET' AND "customerId" IS NOT NULL)
  OR
  ("source" = 'MANUAL_WALK_IN' AND "customerId" IS NULL)
);
-- One active SALO Ticket per customer across SALO
CREATE UNIQUE INDEX "QueueEntry_one_active_salo_ticket_per_customer_key"
ON "QueueEntry" ("customerId")
WHERE
  "source" = 'SALO_TICKET'
  AND "status" IN ('WAITING', 'CALLED');
ALTER TABLE "QueueEntry"
ADD CONSTRAINT "QueueEntry_version_check"
CHECK ("version" >= 1);
ALTER TABLE "QueueEntry"
ADD CONSTRAINT "QueueEntry_lifecycle_check"
CHECK (
  ("status" = 'WAITING'
    AND "calledAt" IS NULL
    AND "startedAt" IS NULL
    AND "cancelledAt" IS NULL
    AND "expiredAt" IS NULL
    AND "noShowAt" IS NULL
    AND "serviceVisitId" IS NULL)
  OR
  ("status" = 'CALLED'
    AND "calledAt" IS NOT NULL
    AND "startedAt" IS NULL
    AND "cancelledAt" IS NULL
    AND "expiredAt" IS NULL
    AND "noShowAt" IS NULL
    AND "serviceVisitId" IS NULL)
  OR
  ("status" = 'STARTED'
    AND "startedAt" IS NOT NULL
    AND "cancelledAt" IS NULL
    AND "expiredAt" IS NULL
    AND "noShowAt" IS NULL
    AND "serviceVisitId" IS NOT NULL)
  OR
  ("status" = 'CANCELLED'
    AND "startedAt" IS NULL
    AND "cancelledAt" IS NOT NULL
    AND "expiredAt" IS NULL
    AND "noShowAt" IS NULL
    AND "serviceVisitId" IS NULL)
  OR
  ("status" = 'EXPIRED'
    AND "startedAt" IS NULL
    AND "cancelledAt" IS NULL
    AND "expiredAt" IS NOT NULL
    AND "noShowAt" IS NULL
    AND "serviceVisitId" IS NULL)
  OR
  ("status" = 'NO_SHOW'
    AND "startedAt" IS NULL
    AND "cancelledAt" IS NULL
    AND "expiredAt" IS NULL
    AND "noShowAt" IS NOT NULL
    AND "serviceVisitId" IS NULL)
);