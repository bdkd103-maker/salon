import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { requireUserFromAuthHeader } from "../lib/auth.js";
import { notifyBookingEvent } from "../lib/push.js";
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
        include: { salon: true, service: true, barber: true, user: true },
      });

      return { bookings };
    } catch {
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

      const { salon, selectedService } = await getSalonBookingContext(payload.salonId, serviceId, barberId);
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

      const booking = await prisma.booking.create({
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

      await notifyBookingEvent({
        userId: user.id,
        ownerId: booking.salon.ownerId,
        bookingId: booking.id,
        salonId: booking.salonId,
        type: "booking-created",
        title: "Booking received",
        body: `Your booking at ${booking.salon.name} is pending confirmation.`,
      });

      return { booking };
    } catch (error: any) {
      if (error?.statusCode === 404) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      return reply.code(401).send({ error: "Unauthorized" });
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

      const canModify = user.id === booking.userId || user.role === "OWNER" || user.role === "ADMIN" || user.role === "STAFF";
      if (!canModify) {
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

      const updated = await prisma.booking.update({
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

      const statusTitleMap: Record<string, string> = {
        PENDING: "Booking updated",
        CONFIRMED: "Booking confirmed",
        CANCELLED: "Booking cancelled",
        COMPLETED: "Booking completed",
        NO_SHOW: "Booking marked no-show",
      };

      const notificationType = updated.status === "CANCELLED"
        ? "booking-cancelled"
        : updated.status === "CONFIRMED"
          ? "booking-confirmed"
          : "booking-updated";

      await notifyBookingEvent({
        userId: booking.userId,
        ownerId: booking.salon.ownerId,
        bookingId: updated.id,
        salonId: updated.salonId,
        type: notificationType,
        title: statusTitleMap[updated.status] ?? "Booking update",
        body: updated.status === "CANCELLED"
          ? `Your booking at ${updated.salon.name} was cancelled.`
          : `Your booking at ${updated.salon.name} has been updated.`,
      });

      return { booking: updated };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.delete("/api/v1/bookings/:id", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const booking = await prisma.booking.findUnique({ where: { id: request.params.id } });

      if (!booking) {
        return reply.code(404).send({ error: "Booking not found" });
      }

      const canModify = user.id === booking.userId || user.role === "OWNER" || user.role === "ADMIN" || user.role === "STAFF";
      if (!canModify) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const cancelled = await prisma.booking.update({
        where: { id: booking.id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancellationReason: "Cancelled by user or staff",
        },
        include: { salon: true },
      });

      await notifyBookingEvent({
        userId: booking.userId,
        ownerId: cancelled.salon.ownerId,
        bookingId: cancelled.id,
        salonId: cancelled.salonId,
        type: "booking-cancelled",
        title: "Booking cancelled",
        body: `Your booking at ${cancelled.salon.name} has been cancelled.`,
      });

      return { booking: cancelled };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
}
