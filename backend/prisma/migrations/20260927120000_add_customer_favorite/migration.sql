-- CreateTable: private customer favorites (customer <-> salon, unique pair)
CREATE TABLE "CustomerFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFavorite_userId_salonId_key" ON "CustomerFavorite"("userId", "salonId");

-- CreateIndex
CREATE INDEX "CustomerFavorite_userId_createdAt_idx" ON "CustomerFavorite"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CustomerFavorite" ADD CONSTRAINT "CustomerFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFavorite" ADD CONSTRAINT "CustomerFavorite_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
