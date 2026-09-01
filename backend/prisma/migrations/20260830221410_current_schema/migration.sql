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
