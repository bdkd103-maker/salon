ALTER TABLE "Notification" ADD COLUMN "readAt" TIMESTAMP(3), ADD COLUMN "eventKey" TEXT;
UPDATE "Notification" SET "readAt" = "createdAt" WHERE "isRead" = true;
CREATE UNIQUE INDEX "Notification_eventKey_key" ON "Notification"("eventKey");
CREATE INDEX "Notification_userId_isRead_createdAt_idx" ON "Notification"("userId", "isRead", "createdAt");
