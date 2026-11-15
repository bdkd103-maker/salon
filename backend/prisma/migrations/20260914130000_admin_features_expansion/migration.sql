-- AlterTable: Add isVerified to Salon
ALTER TABLE "Salon" ADD COLUMN "isVerified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Add type to Offer
ALTER TABLE "Offer" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'REGULAR';

-- AlterTable: Add structured impressum fields to LegalContent
ALTER TABLE "LegalContent" ADD COLUMN "imprintOwnerName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "LegalContent" ADD COLUMN "imprintCompanyName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "LegalContent" ADD COLUMN "imprintStreet" TEXT NOT NULL DEFAULT '';
ALTER TABLE "LegalContent" ADD COLUMN "imprintCity" TEXT NOT NULL DEFAULT '';
ALTER TABLE "LegalContent" ADD COLUMN "imprintCountry" TEXT NOT NULL DEFAULT '';
ALTER TABLE "LegalContent" ADD COLUMN "imprintEmail" TEXT NOT NULL DEFAULT '';
ALTER TABLE "LegalContent" ADD COLUMN "imprintPhone" TEXT NOT NULL DEFAULT '';
ALTER TABLE "LegalContent" ADD COLUMN "imprintRepresentative" TEXT NOT NULL DEFAULT '';
ALTER TABLE "LegalContent" ADD COLUMN "imprintRegister" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "PartnerRequest" (
    "id" TEXT NOT NULL,
    "salonName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "city" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalOffer" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priceText" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "brandId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "retailPrice" DECIMAL(10,2),
    "wholesalePrice" DECIMAL(10,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "priceCents" INTEGER NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
