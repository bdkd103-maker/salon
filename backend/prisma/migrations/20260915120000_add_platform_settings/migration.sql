-- CreateTable: centralized platform-wide admin settings (singleton row)
CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL,
    "siteName" TEXT NOT NULL DEFAULT 'SALO',
    "supportEmail" TEXT NOT NULL DEFAULT '',
    "defaultLocale" TEXT NOT NULL DEFAULT 'ar',
    "customerRegistrationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "salonApplicationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "bookingGloballyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "saloTicketGloballyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "walkInGloballyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "staffStatusLiveEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "PlatformSettings" ("id", "updatedAt")
VALUES ('platform', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
