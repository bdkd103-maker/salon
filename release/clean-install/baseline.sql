-- SALO Step 04: reviewed empty-database baseline PREPARATION ONLY.
-- Never apply manually or to an existing database. Canonical history is unchanged.
-- Derivation: preserve every canonical statement, moving only the premature QueueEntry FK.
BEGIN;
SET LOCAL search_path TO public;

-- Canonical source: backend/prisma/migrations/20260828222701_init/migration.sql
-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'OWNER', 'STAFF', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "SalonStatus" AS ENUM ('OPEN', 'BUSY', 'QUIET', 'CLOSED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('AVAILABLE', 'BOOKED', 'BLOCKED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "avatarUrl" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Salon" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "website" TEXT,
    "description" TEXT,
    "isVip" BOOLEAN NOT NULL DEFAULT false,
    "isWomenOnly" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "status" "SalonStatus" NOT NULL DEFAULT 'OPEN',
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "openingTime" TEXT,
    "closingTime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Salon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Barber" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specialty" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Barber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationMin" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilitySlot" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "barberId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "SlotStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilitySlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "barberId" TEXT,
    "serviceId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "salonId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "salonId" TEXT,
    "senderId" TEXT,
    "receiverId" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalonMedia" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'image',
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalonMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "refreshToken" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Salon_slug_key" ON "Salon"("slug");

-- CreateIndex
CREATE INDEX "AvailabilitySlot_salonId_startAt_idx" ON "AvailabilitySlot"("salonId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "AvailabilitySlot_salonId_barberId_startAt_key" ON "AvailabilitySlot"("salonId", "barberId", "startAt");

-- CreateIndex
CREATE INDEX "Booking_salonId_startAt_idx" ON "Booking"("salonId", "startAt");

-- CreateIndex
CREATE INDEX "Booking_userId_createdAt_idx" ON "Booking"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Review_userId_salonId_key" ON "Review"("userId", "salonId");

-- AddForeignKey
ALTER TABLE "Salon" ADD CONSTRAINT "Salon_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Barber" ADD CONSTRAINT "Barber_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilitySlot" ADD CONSTRAINT "AvailabilitySlot_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilitySlot" ADD CONSTRAINT "AvailabilitySlot_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalonMedia" ADD CONSTRAINT "SalonMedia_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Canonical source: backend/prisma/migrations/20260830221410_current_schema/migration.sql
-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('ANDROID', 'IOS');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE', 'PRO', 'PREMIUM');

-- CreateEnum
CREATE TYPE "LoyaltyRewardType" AS ENUM ('FREE_SERVICE', 'PERCENTAGE_DISCOUNT', 'FIXED_DISCOUNT');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIAL', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BoostStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AvailabilityWatchStatus" AS ENUM ('ACTIVE', 'FIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "availableSlots" INTEGER,
ADD COLUMN     "discount" DECIMAL(10,2),
ADD COLUMN     "endAt" TIMESTAMP(3),
ADD COLUMN     "endTime" TEXT,
ADD COLUMN     "serviceName" TEXT,
ADD COLUMN     "startAt" TIMESTAMP(3),
ADD COLUMN     "startTime" TEXT;

-- CreateTable
CREATE TABLE "UserSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "monthlyPrice" DECIMAL(10,2),
    "startDate" TIMESTAMP(3),
    "renewalDate" TIMESTAMP(3),
    "cancellationDate" TIMESTAMP(3),
    "providerReference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "token" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalonBoost" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "status" "BoostStatus" NOT NULL DEFAULT 'ACTIVE',
    "durationDays" INTEGER NOT NULL DEFAULT 7,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "amountCents" INTEGER DEFAULT 0,
    "currency" TEXT DEFAULT 'EUR',
    "providerReference" TEXT,
    "paymentIntentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalonBoost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyCard" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "requiredStamps" INTEGER NOT NULL DEFAULT 8,
    "rewardType" "LoyaltyRewardType" NOT NULL DEFAULT 'FREE_SERVICE',
    "rewardTitle" TEXT NOT NULL DEFAULT 'Free haircut',
    "rewardText" TEXT NOT NULL DEFAULT 'Free haircut',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyCustomer" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "currentStamps" INTEGER NOT NULL DEFAULT 0,
    "totalVisits" INTEGER NOT NULL DEFAULT 0,
    "lastStampedAt" TIMESTAMP(3),
    "rewardRedeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyStamp" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "barberId" TEXT,
    "transactionId" TEXT NOT NULL,
    "stampAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "verificationToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyStamp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "userId" TEXT,
    "eventType" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'app',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalonAvailabilitySubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "status" "AvailabilityWatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastKnownAvailableChairs" INTEGER NOT NULL DEFAULT 0,
    "lastNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalonAvailabilitySubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSubscription_userId_key" ON "UserSubscription"("userId");

-- CreateIndex
CREATE INDEX "DeviceToken_userId_isActive_idx" ON "DeviceToken"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_userId_token_key" ON "DeviceToken"("userId", "token");

-- CreateIndex
CREATE UNIQUE INDEX "SalonBoost_salonId_key" ON "SalonBoost"("salonId");

-- CreateIndex
CREATE INDEX "SalonBoost_status_endsAt_idx" ON "SalonBoost"("status", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyCustomer_cardId_customerId_key" ON "LoyaltyCustomer"("cardId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyStamp_transactionId_key" ON "LoyaltyStamp"("transactionId");

-- CreateIndex
CREATE INDEX "LoyaltyStamp_cardId_customerId_idx" ON "LoyaltyStamp"("cardId", "customerId");

-- CreateIndex
CREATE INDEX "LoyaltyStamp_transactionId_idx" ON "LoyaltyStamp"("transactionId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_salonId_createdAt_idx" ON "AnalyticsEvent"("salonId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_eventType_createdAt_idx" ON "AnalyticsEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "SalonAvailabilitySubscription_userId_status_idx" ON "SalonAvailabilitySubscription"("userId", "status");

-- CreateIndex
CREATE INDEX "SalonAvailabilitySubscription_salonId_status_idx" ON "SalonAvailabilitySubscription"("salonId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SalonAvailabilitySubscription_userId_salonId_key" ON "SalonAvailabilitySubscription"("userId", "salonId");

-- AddForeignKey
ALTER TABLE "UserSubscription" ADD CONSTRAINT "UserSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalonBoost" ADD CONSTRAINT "SalonBoost_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyCard" ADD CONSTRAINT "LoyaltyCard_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyCustomer" ADD CONSTRAINT "LoyaltyCustomer_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "LoyaltyCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyCustomer" ADD CONSTRAINT "LoyaltyCustomer_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyStamp" ADD CONSTRAINT "LoyaltyStamp_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "LoyaltyCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyStamp" ADD CONSTRAINT "LoyaltyStamp_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalonAvailabilitySubscription" ADD CONSTRAINT "SalonAvailabilitySubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalonAvailabilitySubscription" ADD CONSTRAINT "SalonAvailabilitySubscription_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Canonical source: backend/prisma/migrations/20260903120000_salon_vip_classification_reviews/migration.sql
-- CreateEnum
CREATE TYPE "SalonClassification" AS ENUM ('REGULAR', 'PREMIUM');

-- AlterTable
ALTER TABLE "Salon"
ADD COLUMN "adminVip" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "classification" "SalonClassification" NOT NULL DEFAULT 'REGULAR';

-- Migrate legacy VIP selections into the new manual-admin VIP field.
UPDATE "Salon"
SET "adminVip" = COALESCE("isVip", false)
WHERE "adminVip" = false;

-- Canonical source: backend/prisma/migrations/20260905120000_salon_schedule_timezone/migration.sql
-- Empty days and NULL timezone mean unconfirmed schedule metadata.
ALTER TABLE "Salon"
ADD COLUMN "workingDays" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "timeZone" TEXT;

-- Canonical source: backend/prisma/migrations/20260906180000_customer_registration_verification/migration.sql
-- Additive only: no existing users, numbers or tables are changed.
CREATE TABLE "RegistrationVerificationChallenge" (
  "id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "destination" TEXT NOT NULL,
  "codeDigest" TEXT,
  "generation" INTEGER NOT NULL,
  "deliveryState" TEXT NOT NULL,
  "providerMessageId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "sendCount" INTEGER NOT NULL DEFAULT 0,
  "lastSendAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "registrationTokenHash" TEXT,
  "registrationTokenExpiresAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RegistrationVerificationChallenge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RegistrationVerificationChallenge_destination_purpose_idx" ON "RegistrationVerificationChallenge"("destination", "purpose");
CREATE INDEX "RegistrationVerificationChallenge_expiresAt_idx" ON "RegistrationVerificationChallenge"("expiresAt");
CREATE TABLE "VerificationRateLimitBucket" (
  "id" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VerificationRateLimitBucket_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VerificationRateLimitBucket_expiresAt_idx" ON "VerificationRateLimitBucket"("expiresAt");

-- Canonical source: backend/prisma/migrations/20260907120000_customer_password_reset_challenge/migration.sql
-- Extend the existing password-reset table with short-lived email challenge metadata.
ALTER TABLE "PasswordReset"
  ADD COLUMN "codeDigest" TEXT,
  ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "deliveryState" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "providerMessageId" TEXT,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sendCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastSendAt" TIMESTAMP(3),
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "invalidatedAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "PasswordReset_userId_expiresAt_idx" ON "PasswordReset"("userId", "expiresAt");
CREATE INDEX "PasswordReset_expiresAt_idx" ON "PasswordReset"("expiresAt");

-- Canonical source: backend/prisma/migrations/20260909120000_salon_live_status/migration.sql
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

-- Canonical source: backend/prisma/migrations/20260909130000_staff_membership_foundation/migration.sql
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

-- Canonical source: backend/prisma/migrations/20260909140000_staff_presence_foundation/migration.sql
-- CreateEnum
CREATE TYPE "StaffDutyState" AS ENUM ('ON_DUTY', 'OFF_DUTY');

-- CreateEnum
CREATE TYPE "StaffPresenceChangeSource" AS ENUM ('STAFF', 'OWNER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "StaffPresenceEvidenceSource" AS ENUM ('STAFF_APP', 'OWNER', 'SALO_STATION', 'SERVICE_EVENT');

-- CreateTable
CREATE TABLE "StaffPresence" (
    "staffMembershipId" TEXT NOT NULL,
    "dutyState" "StaffDutyState" NOT NULL,
    "generation" INTEGER NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL,
    "changedByUserId" TEXT,
    "changeSource" "StaffPresenceChangeSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffPresence_pkey" PRIMARY KEY ("staffMembershipId")
);

-- CreateTable
CREATE TABLE "StaffPresenceLease" (
    "id" TEXT NOT NULL,
    "staffMembershipId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "evidenceSource" "StaffPresenceEvidenceSource" NOT NULL,
    "producerKey" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffPresenceLease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffPresence_changedByUserId_idx" ON "StaffPresence"("changedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffPresenceLease_staffMembershipId_evidenceSource_producerKey_key" ON "StaffPresenceLease"("staffMembershipId", "evidenceSource", "producerKey");

-- CreateIndex
CREATE INDEX "StaffPresenceLease_staffMembershipId_generation_validUntil_idx" ON "StaffPresenceLease"("staffMembershipId", "generation", "validUntil");

-- AddForeignKey
ALTER TABLE "StaffPresence" ADD CONSTRAINT "StaffPresence_staffMembershipId_fkey" FOREIGN KEY ("staffMembershipId") REFERENCES "StaffMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPresence" ADD CONSTRAINT "StaffPresence_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPresenceLease" ADD CONSTRAINT "StaffPresenceLease_staffMembershipId_fkey" FOREIGN KEY ("staffMembershipId") REFERENCES "StaffPresence"("staffMembershipId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Canonical source: backend/prisma/migrations/20260909231832_queue_entry_foundation/migration.sql
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
-- ServiceVisit FK deferred below; all other canonical SQL is retained.
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

-- Canonical source: backend/prisma/migrations/20260910120000_staff_presence_lease_index_name/migration.sql
ALTER INDEX
  "StaffPresenceLease_staffMembershipId_evidenceSource_producerKey"
RENAME TO
  "StaffPresenceLease_source_key";

-- Canonical source: backend/prisma/migrations/20260910130000_service_visit_foundation/migration.sql
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
-- Deferred FK: target and its primary key now exist.
ALTER TABLE "QueueEntry"
ADD CONSTRAINT "QueueEntry_serviceVisitId_fkey"
FOREIGN KEY ("serviceVisitId")
REFERENCES "ServiceVisit"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

-- Canonical source: backend/prisma/migrations/20260910134000_salon_intake_controls/migration.sql
ALTER TABLE "Salon"
ADD COLUMN "bookingIntakeEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "saloTicketIntakeEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "walkInIntakeEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Canonical source: backend/prisma/migrations/20260911120000_add_smart_subscription_plan/migration.sql
ALTER TYPE "SubscriptionPlan" ADD VALUE 'SMART' AFTER 'FREE';

-- Canonical source: backend/prisma/migrations/20260912120000_add_salon_enforcement/migration.sql
CREATE TABLE "SalonEnforcement" (
    "id" UUID NOT NULL,
    "salonId" TEXT NOT NULL,
    "salonName" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "enforcedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousIsActive" BOOLEAN NOT NULL,
    "subscription" JSONB,

    CONSTRAINT "SalonEnforcement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SalonEnforcement_salonId_enforcedAt_idx"
    ON "SalonEnforcement"("salonId", "enforcedAt");

-- Canonical source: backend/prisma/migrations/20260912150000_add_salon_archive/migration.sql
CREATE TABLE "SalonArchive" (
    "archiveId" UUID NOT NULL,
    "salonId" TEXT NOT NULL,
    "salonName" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "archiveVersion" INTEGER NOT NULL DEFAULT 1,
    "payloadVersion" INTEGER NOT NULL DEFAULT 1,
    "coverage" JSONB NOT NULL,
    "sourceState" JSONB NOT NULL,
    "evidence" JSONB,
    "source" TEXT NOT NULL,
    "finalizedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalonArchive_pkey" PRIMARY KEY ("archiveId")
);

CREATE INDEX "SalonArchive_salonId_finalizedAt_idx"
ON "SalonArchive"("salonId", "finalizedAt");

-- Canonical source: backend/prisma/migrations/20260913120000_add_salon_retention_clearance/migration.sql
CREATE TABLE "SalonRetentionHold" (
    "id" UUID NOT NULL,
    "salonId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releasedByUserId" TEXT,
    "releaseReason" TEXT,
    CONSTRAINT "SalonRetentionHold_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SalonRetentionHold_salonId_releasedAt_idx" ON "SalonRetentionHold"("salonId", "releasedAt");

CREATE TABLE "SalonPurgeClearance" (
    "id" UUID NOT NULL,
    "salonId" TEXT NOT NULL,
    "archiveId" UUID NOT NULL,
    "archiveVersion" INTEGER NOT NULL,
    "payloadVersion" INTEGER NOT NULL,
    "archiveFinalizedAt" TIMESTAMP(3) NOT NULL,
    "sourceState" JSONB NOT NULL,
    "coverage" JSONB NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revocationReason" TEXT,
    CONSTRAINT "SalonPurgeClearance_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SalonPurgeClearance_salonId_revokedAt_idx" ON "SalonPurgeClearance"("salonId", "revokedAt");
CREATE INDEX "SalonPurgeClearance_archiveId_idx" ON "SalonPurgeClearance"("archiveId");

-- Canonical source: backend/prisma/migrations/20260914120000_add_legal_content/migration.sql
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

-- Canonical source: backend/prisma/migrations/20260914130000_admin_features_expansion/migration.sql
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

-- Canonical source: backend/prisma/migrations/20260915120000_add_platform_settings/migration.sql
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

-- Canonical source: backend/prisma/migrations/20260926120000_notification_read_state/migration.sql
ALTER TABLE "Notification" ADD COLUMN "readAt" TIMESTAMP(3), ADD COLUMN "eventKey" TEXT;
UPDATE "Notification" SET "readAt" = "createdAt" WHERE "isRead" = true;
CREATE UNIQUE INDEX "Notification_eventKey_key" ON "Notification"("eventKey");
CREATE INDEX "Notification_userId_isRead_createdAt_idx" ON "Notification"("userId", "isRead", "createdAt");

-- Canonical source: backend/prisma/migrations/20260927120000_add_customer_favorite/migration.sql
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

-- Canonical source: backend/prisma/migrations/20260929120000_loyalty_ledger/migration.sql
-- Extend the existing stamp ledger; preserve all existing cards and balances.
ALTER TABLE "LoyaltyCard" ADD COLUMN "rewardActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "LoyaltyStamp" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'EARN',
 ADD COLUMN "amount" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "sourceVisitId" TEXT,
 ADD COLUMN "sourceBookingId" TEXT,
 ADD COLUMN "rewardTitle" TEXT;
ALTER TABLE "LoyaltyStamp" ADD CONSTRAINT "LoyaltyStamp_value_check"
 CHECK (("kind" = 'EARN' AND "amount" = 1) OR ("kind" = 'REDEEM' AND "amount" < 0));

-- Canonical source: backend/prisma/migrations/20260930120000_add_salon_extras/migration.sql
-- CreateTable: owner-configured salon extras / amenities (one row per salon)
CREATE TABLE "SalonExtras" (
    "salonId" TEXT NOT NULL,
    "extras" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalonExtras_pkey" PRIMARY KEY ("salonId")
);

-- AddForeignKey
ALTER TABLE "SalonExtras" ADD CONSTRAINT "SalonExtras_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Canonical source: backend/prisma/migrations/20261114010000_staff_onboarding_foundation/migration.sql
-- Additive foundation only. REVIEW before applying; never run automatically.
ALTER TABLE "User"
  ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "staffPasswordChangeRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD CONSTRAINT "User_authVersion_nonnegative" CHECK ("authVersion" >= 0);

-- The default preserves existing Customer reset challenges/proofs and their HMAC format.
ALTER TABLE "PasswordReset" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'CUSTOMER_PASSWORD_RESET';
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_purpose_check"
  CHECK ("purpose" IN ('CUSTOMER_PASSWORD_RESET', 'STAFF_PASSWORD_RESET'));

CREATE TYPE "StaffInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED');
CREATE TYPE "StaffInvitationDelivery" AS ENUM ('PENDING', 'ACCEPTED', 'FAILED', 'UNKNOWN');
CREATE TABLE "StaffInvitation" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "initiatedByUserId" TEXT NOT NULL,
  "destinationEmail" TEXT NOT NULL,
  "intendedUserId" TEXT,
  "fullName" TEXT NOT NULL,
  "phone" TEXT,
  "barberName" TEXT NOT NULL,
  "secretDigest" TEXT,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "status" "StaffInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "deliveryState" "StaffInvitationDelivery" NOT NULL DEFAULT 'PENDING',
  "providerMessageId" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "declinedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "acceptedByUserId" TEXT,
  "sendCount" INTEGER NOT NULL DEFAULT 0,
  "resendCount" INTEGER NOT NULL DEFAULT 0,
  "lastSendAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StaffInvitation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StaffInvitation_email_normalized" CHECK (
    "destinationEmail" = lower(btrim("destinationEmail")) AND length("destinationEmail") BETWEEN 3 AND 254
  ),
  CONSTRAINT "StaffInvitation_digest_format" CHECK ("secretDigest" IS NULL OR "secretDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "StaffInvitation_counters_check" CHECK ("generation" >= 1 AND "sendCount" >= 0 AND "resendCount" >= 0),
  CONSTRAINT "StaffInvitation_expiry_check" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "StaffInvitation_lifecycle_check" CHECK (
    ("status" = 'PENDING' AND "secretDigest" IS NOT NULL AND "acceptedAt" IS NULL AND "revokedAt" IS NULL AND "declinedAt" IS NULL AND "consumedAt" IS NULL)
    OR ("status" = 'ACCEPTED' AND "acceptedAt" IS NOT NULL AND "consumedAt" IS NOT NULL AND "secretDigest" IS NULL)
    OR ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL AND "secretDigest" IS NULL)
    OR ("status" = 'DECLINED' AND "declinedAt" IS NOT NULL AND "secretDigest" IS NULL)
    OR ("status" = 'EXPIRED' AND "secretDigest" IS NULL)
  )
);
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_intendedUserId_fkey" FOREIGN KEY ("intendedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Expired PENDING rows still occupy the slot until explicitly transitioned later.
-- Do not use now() in a partial-index predicate or a check-then-insert application lock.
CREATE UNIQUE INDEX "StaffInvitation_one_pending_per_salon_email_key"
  ON "StaffInvitation"("salonId", "destinationEmail") WHERE "status" = 'PENDING';
CREATE INDEX "StaffInvitation_salonId_status_idx" ON "StaffInvitation"("salonId", "status");
CREATE INDEX "StaffInvitation_destinationEmail_expiresAt_idx" ON "StaffInvitation"("destinationEmail", "expiresAt");
CREATE INDEX "StaffInvitation_initiatedByUserId_idx" ON "StaffInvitation"("initiatedByUserId");
CREATE INDEX "StaffInvitation_intendedUserId_idx" ON "StaffInvitation"("intendedUserId");
CREATE INDEX "StaffInvitation_acceptedByUserId_idx" ON "StaffInvitation"("acceptedByUserId");

COMMIT;
