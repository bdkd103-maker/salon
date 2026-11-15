-- CreateTable
CREATE TABLE "LegalContent" (
    "id" TEXT NOT NULL,
    "impressum" TEXT NOT NULL DEFAULT '',
    "datenschutz" TEXT NOT NULL DEFAULT '',
    "agb" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalContent_pkey" PRIMARY KEY ("id")
);
