-- CreateTable
CREATE TABLE "SalonLiveStatus" (
    "salonId" TEXT NOT NULL,
    "operationalState" TEXT,
    "observedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalonLiveStatus_pkey" PRIMARY KEY ("salonId")
);

-- AddForeignKey
ALTER TABLE "SalonLiveStatus" ADD CONSTRAINT "SalonLiveStatus_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
