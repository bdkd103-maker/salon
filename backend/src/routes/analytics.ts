import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { requireUserFromAuthHeader } from "../lib/auth.js";
import { buildAnalyticsSummary, buildDateRangeSummary, normalizeEventType } from "../lib/analytics.js";

const analyticsEventSchema = z.object({
  salonId: z.string().trim().min(1).optional().or(z.literal("")),
  eventType: z.string().trim().min(1),
  source: z.string().trim().max(80).optional().or(z.literal("")),
  metadata: z.record(z.any()).optional(),
});

export async function analyticsRoutes(app: any) {
  app.post("/api/v1/analytics/events", async (request: any, reply: any) => {
    try {
      const user = request.headers.authorization ? await requireUserFromAuthHeader(request, reply).catch(() => null) : null;
      const parsed = analyticsEventSchema.safeParse(request.body ?? {});

      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const payload = parsed.data;
      const eventType = normalizeEventType(payload.eventType);
      if (!payload.salonId) {
        return { ok: true, created: false, reason: "No salon id" };
      }

      const event = await prisma.analyticsEvent.create({
        data: {
          salonId: payload.salonId,
          userId: user?.id ?? null,
          eventType,
          source: payload.source || "app",
          metadata: payload.metadata ?? {},
        },
      });

      return { ok: true, event };
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || "Failed to track analytics event" });
    }
  });

  app.get("/api/v1/analytics/salons/:salonId/summary", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const salon = await prisma.salon.findUnique({
        where: { id: request.params.salonId },
        select: { id: true, ownerId: true },
      });

      if (!salon) {
        return reply.code(404).send({ error: "Salon not found" });
      }

      if (user.role !== "ADMIN" && salon.ownerId !== user.id) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const rangeDays = Math.min(90, Math.max(7, Number(request.query.rangeDays || 7)));
      const [events, bookings, loyaltyStamps] = await Promise.all([
        prisma.analyticsEvent.findMany({
          where: { salonId: salon.id },
          orderBy: { createdAt: "desc" },
        }),
        prisma.booking.findMany({
          where: { salonId: salon.id },
          select: { createdAt: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.loyaltyStamp.findMany({
          where: {
            card: { salonId: salon.id },
            isValid: true,
          },
          select: { stampAt: true },
          orderBy: { stampAt: "desc" },
        }),
      ]);

      const analyticsSummary = buildAnalyticsSummary(events.map((event) => ({
        id: event.id,
        salonId: event.salonId,
        userId: event.userId,
        eventType: normalizeEventType(event.eventType),
        source: event.source,
        metadata: (event.metadata as Record<string, any>) || {},
        createdAt: event.createdAt,
      })), rangeDays);

      return {
        summary: {
          ...analyticsSummary,
          bookings: buildDateRangeSummary(bookings, rangeDays),
          loyaltyUsage: buildDateRangeSummary(loyaltyStamps.map((stamp) => ({ createdAt: stamp.stampAt })), rangeDays),
        },
      };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
}
