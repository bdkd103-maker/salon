-- CreateEnum
CREATE TYPE "ServiceVisitSource" AS ENUM ('BOOKING', 'WALK_IN');

-- CreateEnum
CREATE TYPE "ServiceVisitStatus" AS ENUM ('IN_SERVICE', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ServiceVisit" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "bookingId" TEXT,
    "staffMembershipId" TEXT NOT NULL,
    "source" "ServiceVisitSource" NOT NULL,
    "status" "ServiceVisitStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "startedByUserId" TEXT,
    "completedByUserId" TEXT,
    "cancelledByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceVisit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ServiceVisit_source_booking_check" CHECK (
        ("source" = 'BOOKING' AND "bookingId" IS NOT NULL)
        OR ("source" = 'WALK_IN' AND "bookingId" IS NULL)
    ),
    CONSTRAINT "ServiceVisit_version_check" CHECK ("version" >= 1),
    CONSTRAINT "ServiceVisit_lifecycle_check" CHECK (
        ("status" = 'IN_SERVICE' AND "completedAt" IS NULL AND "cancelledAt" IS NULL)
        OR ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL AND "cancelledAt" IS NULL AND "completedAt" >= "startedAt")
        OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "completedAt" IS NULL AND "cancelledAt" >= "startedAt")
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "Booking_id_salonId_key" ON "Booking"("id", "salonId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMembership_id_salonId_key" ON "StaffMembership"("id", "salonId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceVisit_bookingId_key" ON "ServiceVisit"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceVisit_bookingId_salonId_key" ON "ServiceVisit"("bookingId", "salonId");

-- CreateIndex
CREATE INDEX "ServiceVisit_salonId_status_startedAt_idx" ON "ServiceVisit"("salonId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "ServiceVisit_staffMembershipId_status_idx" ON "ServiceVisit"("staffMembershipId", "status");

-- CreateIndex
CREATE INDEX "ServiceVisit_startedByUserId_idx" ON "ServiceVisit"("startedByUserId");

-- CreateIndex
CREATE INDEX "ServiceVisit_completedByUserId_idx" ON "ServiceVisit"("completedByUserId");

-- CreateIndex
CREATE INDEX "ServiceVisit_cancelledByUserId_idx" ON "ServiceVisit"("cancelledByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceVisit_one_active_per_staff_key"
ON "ServiceVisit"("staffMembershipId")
WHERE "status" = 'IN_SERVICE';

-- AddForeignKey
ALTER TABLE "ServiceVisit" ADD CONSTRAINT "ServiceVisit_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceVisit" ADD CONSTRAINT "ServiceVisit_bookingId_salonId_fkey" FOREIGN KEY ("bookingId", "salonId") REFERENCES "Booking"("id", "salonId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceVisit" ADD CONSTRAINT "ServiceVisit_staffMembershipId_salonId_fkey" FOREIGN KEY ("staffMembershipId", "salonId") REFERENCES "StaffMembership"("id", "salonId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceVisit" ADD CONSTRAINT "ServiceVisit_startedByUserId_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceVisit" ADD CONSTRAINT "ServiceVisit_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceVisit" ADD CONSTRAINT "ServiceVisit_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;