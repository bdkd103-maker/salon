import { earnCompletedBooking } from "../lib/loyalty-ledger.js";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { getPlatformSettings } from "../lib/platform-settings.js";
import { requireUserFromAuthHeader } from "../lib/auth.js";
import { notifyOperationalEvent } from "../lib/notifications.js";
import {
  isHoliday,
  isWithinOperatingHours,
  isWeekend,
  parseWallClockInTimeZone,
  toMinutes,
} from "../lib/booking-time.js";

const bookingSchema = z.object({
  salonId: z.string().trim().min(1),
  serviceId: z.string().trim().min(1).optional().or(z.literal("")),
  barberId: z.string().trim().min(1).optional().or(z.literal("")),
  startAt: z.string().trim().min(1),
  endAt: z.string().trim().min(1),
  timeZone: z.string().trim().min(1).optional(),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

const bookingUpdateSchema = z.object({
  serviceId: z.string().trim().min(1).optional().or(z.literal("")),
  barberId: z.string().trim().min(1).optional().or(z.literal("")),
  startAt: z.string().trim().min(1).optional(),
  endAt: z.string().trim().min(1).optional(),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  status: z.enum(["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"]).optional(),
  cancellationReason: z.string().trim().max(500).optional().or(z.literal("")),
  timeZone: z.string().trim().min(1).optional(),
});

const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["COMPLETED", "CANCELLED", "NO_SHOW"],
};

function isLegalStatusTransition(from: string, to: string): boolean {
  if (from === to) return true;
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

function canMutateBooking(
  user: { id: string; role: string },
  booking: { userId: string; status: string; salon: { ownerId: string } },
  requestedStatus?: string,
) {
  if (user.role === "ADMIN") return true;
  if (user.role === "OWNER" || user.role === "STAFF") {
    if (booking.salon.ownerId !== user.id) return false;
    if (requestedStatus !== undefined && !isLegalStatusTransition(booking.status, requestedStatus)) return false;
    return true;
  }
  return user.role === "CUSTOMER"
    && booking.userId === user.id
    && ["PENDING", "CONFIRMED"].includes(booking.status)
    && (requestedStatus === undefined || requestedStatus === booking.status || requestedStatus === "CANCELLED");
}

function validateBookingWindow(salon: any, startAt: Date, endAt: Date, timeZone: string, requestedServiceDurationMin: number) {
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
    return "Invalid time window";
  }

  const durationMs = requestedServiceDurationMin * 60_000;
  if (endAt.getTime() - startAt.getTime() < durationMs - 30_000) {
    return "Service duration does not match selected slot";
  }

  const opening = salon.openingTime || "09:00";
  const closing = salon.closingTime || "20:00";
  const startLocal = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(startAt).replace(" ", "T");

  const endLocal = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(endAt).replace(" ", "T");

  if (!isWithinOperatingHours(startLocal, endLocal, timeZone, opening, closing)) {
    return "Selected time is outside salon opening hours";
  }

  if (isWeekend(startAt, timeZone) || isHoliday(startAt, timeZone)) {
    return "Selected day is unavailable";
  }

  if (toMinutes(closing) <= toMinutes(opening)) {
    return "Invalid salon opening configuration";
  }

  return null;
}

async function getSalonBookingContext(salonId: string, serviceId: string | null, barberId: string | null) {
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    include: { services: true, barbers: true },
  });

  if (!salon || !salon.isActive) {
    throw Object.assign(new Error("Salon not found or inactive"), { statusCode: 404 });
  }

  const selectedService = serviceId ? salon.services.find((service: any) => service.id === serviceId) : null;
  if (serviceId && !selectedService) {
    throw Object.assign(new Error("Service not found"), { statusCode: 404 });
  }

  const selectedBarber = barberId ? salon.barbers.find((barber: any) => barber.id === barberId) : null;
  if (barberId && !selectedBarber) {
    throw Object.assign(new Error("Barber not found"), { statusCode: 404 });
  }

  return { salon, selectedService, selectedBarber };
}

export async function bookingRoutes(app: any) {
  app.get("/api/v1/bookings", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      if (user.role !== "OWNER" && user.role !== "ADMIN" && user.role !== "STAFF") {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const bookings = await prisma.booking.findMany({
        where: user.role === "ADMIN" ? {} : { salon: { ownerId: user.id } },
        orderBy: { startAt: "asc" },
        include: {
          salon: true, service: true, barber: true,
          user: { select: { id: true, fullName: true, email: true, phone: true } },
        },
      });

      return { bookings };
    } catch {
      if (reply.sent) return reply;
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.get("/api/v1/bookings/me", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const bookings = await prisma.booking.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        include: { salon: true, service: true, barber: true },
      });

      return { bookings };
    } catch {
      if (reply.sent) return reply;
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.post("/api/v1/bookings", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const parsed = bookingSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const payload = parsed.data;
      const serviceId = payload.serviceId && payload.serviceId.trim() ? payload.serviceId.trim() : null;
      const barberId = payload.barberId && payload.barberId.trim() ? payload.barberId.trim() : null;
      const notes = payload.notes && payload.notes.trim() ? payload.notes.trim() : null;
      const timeZone = payload.timeZone || "Europe/Berlin";

      const settings = await getPlatformSettings();
      if (!settings.bookingGloballyEnabled) {
        return reply.code(409).send({ error: "Booking intake is currently disabled" });
      }
      const { salon, selectedService } = await getSalonBookingContext(payload.salonId, serviceId, barberId);
      if (!salon.bookingIntakeEnabled) {
        return reply.code(409).send({ error: "Booking intake is currently disabled" });
      }
      const startAt = parseWallClockInTimeZone(payload.startAt, timeZone);
      const endAt = parseWallClockInTimeZone(payload.endAt, timeZone);

      const requestedDurationMin = selectedService?.durationMin ?? 60;
      const validationError = validateBookingWindow(salon, startAt, endAt, timeZone, requestedDurationMin);
      if (validationError) {
        return reply.code(400).send({ error: validationError });
      }

      if (barberId && !selectedService) {
        return reply.code(400).send({ error: "A service is required when selecting a barber" });
      }

      const overlaps = await prisma.booking.count({
        where: {
          salonId: payload.salonId,
          status: { in: ["PENDING", "CONFIRMED"] },
          startAt: { lt: endAt },
          endAt: { gt: startAt },
          ...(barberId ? { barberId } : {}),
        },
      });

      if (overlaps > 0) {
        return reply.code(409).send({ error: "Booking slot is no longer available" });
      }

      const booking = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.create({
        data: {
          userId: user.id,
          salonId: payload.salonId,
          serviceId: serviceId ?? null,
          barberId: barberId ?? null,
          startAt,
          endAt,
          status: "PENDING",
          notes: notes ?? null,
          customerName: user.fullName,
          customerPhone: user.phone ?? null,
        },
        include: {
          salon: true,
          service: true,
          barber: true,
        },
      });

      await notifyOperationalEvent(tx, { entity: "booking", id: booking.id, salonId: booking.salonId,
        customerId: user.id, ownerId: booking.salon.ownerId, actorId: user.id, state: "CREATED", revision: "created" });
      return booking;
      });

      return { booking };
    } catch (error: any) {
      if (reply.sent) return reply;
      if (error?.statusCode === 404) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      return reply.code(500).send({ error: "Operation could not be saved" });
    }
  });

  app.patch("/api/v1/bookings/:id", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const parsed = bookingUpdateSchema.safeParse(request.body ?? {});

      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const booking = await prisma.booking.findUnique({
        where: { id: request.params.id },
        include: { salon: true, service: true, barber: true },
      });

      if (!booking) {
        return reply.code(404).send({ error: "Booking not found" });
      }

      if (!canMutateBooking(user, booking, parsed.data.status)) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const nextServiceId = parsed.data.serviceId && parsed.data.serviceId.trim() ? parsed.data.serviceId.trim() : booking.serviceId;
      const nextBarberId = parsed.data.barberId && parsed.data.barberId.trim() ? parsed.data.barberId.trim() : booking.barberId;
      const nextStartAt = parsed.data.startAt ? parseWallClockInTimeZone(parsed.data.startAt, parsed.data.timeZone || "Europe/Berlin") : booking.startAt;
      const nextEndAt = parsed.data.endAt ? parseWallClockInTimeZone(parsed.data.endAt, parsed.data.timeZone || "Europe/Berlin") : booking.endAt;
      const nextStatus = parsed.data.status ?? booking.status;

      const nextService = nextServiceId ? await prisma.service.findUnique({ where: { id: nextServiceId } }) : booking.service;
      if (nextServiceId && !nextService) {
        return reply.code(404).send({ error: "Service not found" });
      }
      if (nextService && nextService.salonId !== booking.salonId) {
        return reply.code(400).send({ error: "Service must belong to the booking salon" });
      }

      if (nextBarberId) {
        const nextBarber = await prisma.barber.findUnique({
          where: { id: nextBarberId },
          select: { id: true, salonId: true },
        });
        if (!nextBarber) {
          return reply.code(404).send({ error: "Barber not found" });
        }
        if (nextBarber.salonId !== booking.salonId) {
          return reply.code(400).send({ error: "Barber must belong to the booking salon" });
        }
      }

      const validationError = validateBookingWindow(
        booking.salon,
        nextStartAt,
        nextEndAt,
        parsed.data.timeZone || "Europe/Berlin",
        nextService?.durationMin ?? booking.service?.durationMin ?? 60,
      );
      if (validationError) {
        return reply.code(400).send({ error: validationError });
      }

      const overlapQuery: any = {
        salonId: booking.salonId,
        status: { in: ["PENDING", "CONFIRMED"] as const },
        id: { not: booking.id },
        startAt: { lt: nextEndAt },
        endAt: { gt: nextStartAt },
        ...(nextBarberId ? { barberId: nextBarberId } : {}),
      };

      const overlapCount = await prisma.booking.count({ where: overlapQuery });
      if (overlapCount > 0) {
        return reply.code(409).send({ error: "Booking slot is no longer available" });
      }

      const updated = await prisma.$transaction(async (tx) => {
      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: {
          serviceId: nextServiceId ?? booking.serviceId,
          barberId: nextBarberId ?? booking.barberId,
          startAt: nextStartAt,
          endAt: nextEndAt,
          status: nextStatus,
          notes: parsed.data.notes !== undefined ? (parsed.data.notes?.trim() || null) : booking.notes,
          cancellationReason: parsed.data.cancellationReason ? parsed.data.cancellationReason.trim() : booking.cancellationReason,
          cancelledAt: nextStatus === "CANCELLED" && booking.cancelledAt === null ? new Date() : booking.cancelledAt,
        },
        include: { salon: true, service: true, barber: true },
      });

        if (booking.status !== updated.status) await earnCompletedBooking(tx, updated);
      const changed = booking.status !== updated.status || +booking.startAt !== +updated.startAt ||
        +booking.endAt !== +updated.endAt || booking.serviceId !== updated.serviceId || booking.barberId !== updated.barberId;
      if (changed) await notifyOperationalEvent(tx, { entity: "booking", id: updated.id, salonId: updated.salonId,
        customerId: booking.userId, ownerId: booking.salon.ownerId, actorId: user.id,
        state: booking.status !== updated.status ? updated.status : "UPDATED",
        revision: [updated.status, updated.startAt.toISOString(), updated.endAt.toISOString(), updated.serviceId, updated.barberId].join(":") });
      return updated;
      });

      return { booking: updated };
    } catch {
      if (reply.sent) return reply;
      return reply.code(500).send({ error: "Operation could not be saved" });
    }
  });

  app.delete("/api/v1/bookings/:id", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const booking = await prisma.booking.findUnique({
        where: { id: request.params.id },
        include: { salon: { select: { ownerId: true } } },
      });

      if (!booking) {
        return reply.code(404).send({ error: "Booking not found" });
      }

      if (!canMutateBooking(user, booking, "CANCELLED")) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const cancelled = await prisma.$transaction(async (tx) => {
      const cancelled = await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancellationReason: "Cancelled by user or staff",
        },
        include: { salon: true },
      });

      if (booking.status !== "CANCELLED") await notifyOperationalEvent(tx, {
        entity: "booking", id: cancelled.id, salonId: cancelled.salonId, customerId: booking.userId,
        ownerId: cancelled.salon.ownerId, actorId: user.id, state: "CANCELLED",
        revision: [cancelled.status, cancelled.startAt.toISOString(), cancelled.endAt.toISOString(), cancelled.serviceId, cancelled.barberId].join(":") });
      return cancelled;
      });

      return { booking: cancelled };
    } catch {
      if (reply.sent) return reply;
      return reply.code(500).send({ error: "Operation could not be saved" });
    }
  });
}
