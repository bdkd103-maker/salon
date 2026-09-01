import { prisma } from "./prisma.js";

export function normalizeAvailabilitySubscriptionStatus(value?: string | null) {
  const normalized = String(value ?? "ACTIVE").trim().toUpperCase();
  if (normalized === "CANCELLED") return "CANCELLED";
  if (normalized === "FIRED") return "FIRED";
  return "ACTIVE";
}

export function dedupeNotificationKey({ userId, salonId }: { userId: string; salonId: string }) {
  return `${userId}:${salonId}:chair-available`;
}

export function shouldNotifySalonAvailability({
  previousAvailableChairs,
  currentAvailableChairs,
  status,
}: {
  previousAvailableChairs: number;
  currentAvailableChairs: number;
  status?: string | null;
}) {
  if (normalizeAvailabilitySubscriptionStatus(status) !== "ACTIVE") {
    return false;
  }

  const previousValue = Number(previousAvailableChairs ?? 0);
  const currentValue = Number(currentAvailableChairs ?? 0);

  return previousValue <= 0 && currentValue > 0;
}

export async function notifyAvailabilityWatchEvent({
  userId,
  salonId,
  salonName,
  availableChairs,
}: {
  userId: string;
  salonId: string;
  salonName: string;
  availableChairs: number;
}) {
  const dedupeKey = dedupeNotificationKey({ userId, salonId });

  const existing = await prisma.notification.findFirst({
    where: {
      userId,
      type: "salon-chair-available",
      metadata: {
        path: ["dedupeKey"],
        equals: dedupeKey,
      } as any,
    },
  });

  if (existing) {
    return { created: false, notification: existing };
  }

  const notification = await prisma.notification.create({
    data: {
      userId,
      title: "Chair available",
      body: `${salonName} has a free chair available again.`,
      type: "salon-chair-available",
      metadata: {
        dedupeKey,
        salonId,
        availableChairs,
        createdAt: new Date().toISOString(),
      },
      isRead: false,
    },
  });

  return { created: true, notification };
}

export async function notifyBookingEvent(_payload?: any) {
  return { ok: true };
}
