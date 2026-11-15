-- CreateTable: owner-configured salon extras / amenities (one row per salon)
CREATE TABLE "SalonExtras" (
    "salonId" TEXT NOT NULL,
    "extras" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalonExtras_pkey" PRIMARY KEY ("salonId")
);

-- AddForeignKey
ALTER TABLE "SalonExtras" ADD CONSTRAINT "SalonExtras_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
