-- CreateEnum
CREATE TYPE "StaffMembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateTable
CREATE TABLE "StaffMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "barberId" TEXT NOT NULL,
    "status" "StaffMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "StaffMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Barber_id_salonId_key" ON "Barber"("id", "salonId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMembership_barberId_key" ON "StaffMembership"("barberId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMembership_userId_salonId_key" ON "StaffMembership"("userId", "salonId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMembership_barberId_salonId_key" ON "StaffMembership"("barberId", "salonId");

-- CreateIndex
CREATE INDEX "StaffMembership_salonId_status_idx" ON "StaffMembership"("salonId", "status");

-- AddForeignKey
ALTER TABLE "StaffMembership" ADD CONSTRAINT "StaffMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffMembership" ADD CONSTRAINT "StaffMembership_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffMembership" ADD CONSTRAINT "StaffMembership_barberId_salonId_fkey" FOREIGN KEY ("barberId", "salonId") REFERENCES "Barber"("id", "salonId") ON DELETE CASCADE ON UPDATE CASCADE;