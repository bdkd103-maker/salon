import { notifyOperationalEvent } from "../lib/notifications.js";
import { z } from "zod";

import { requireRole, requireUserFromAuthHeader } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { getPlatformSettings } from "../lib/platform-settings.js";
import { getQueueTransition } from "../lib/queue-entry.js";
import { resolveEffectiveStaffPresence } from "../lib/staff-presence.js";
import { isValidServiceVisitStartContext } from "../lib/service-visit.js";
import { projectSmartWaitForPublic } from "../lib/smart-wait.js";
import { computeWaitForSalon, smartWaitMembershipInclude } from "../lib/smart-wait-data.js";
const salonParamsSchema = z.object({
  salonId: z.string().uuid(),
});

const queueEntryParamsSchema = z.object({
  salonId: z.string().uuid(),
  queueEntryId: z.string().uuid(),
});

const startQueueEntrySchema = z.object({
  staffMembershipId: z.string().uuid(),
});

export async function queueRoutes(app: any) {
  // CUSTOMER: create or return the customer's existing active SALO Ticket.
  app.post("/api/v1/salons/:salonId/queue/tickets", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      requireRole(user, ["CUSTOMER"], reply);

      const parsed = salonParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid salon id" });
      }

      const { salonId } = parsed.data;

      const salon = await prisma.salon.findUnique({
        where: { id: salonId },
      select: {
  id: true,
  saloTicketIntakeEnabled: true,
  walkInIntakeEnabled: true,
  isActive: true,
  ownerId: true,
},
      });

      if (!salon) {
        return reply.code(404).send({ error: "Salon not found" });
      }

      const platformSettings = await getPlatformSettings();
      if (!platformSettings.saloTicketGloballyEnabled || !platformSettings.walkInGloballyEnabled) {
        return reply.code(409).send({
          error: "SALO Ticket intake is currently disabled",
        });
      }

      const existing = await prisma.queueEntry.findFirst({
        where: {
          customerId: user.id,
          source: "SALO_TICKET",
          status: { in: ["WAITING", "CALLED"] },
        },
        orderBy: { joinedAt: "asc" },
      });

      if (existing) {
        return { ok: true, created: false, queueEntry: existing };
      }
if (!salon.isActive || !salon.saloTicketIntakeEnabled || !salon.walkInIntakeEnabled) {
  return reply.code(409).send({
    error: "SALO Ticket intake is currently disabled",
  });
}
      try {
        const queueEntry = await prisma.$transaction(async (tx) => {
        const queueEntry = await tx.queueEntry.create({
          data: {
            salonId,
            customerId: user.id,
            source: "SALO_TICKET",
            status: "WAITING",
            joinedAt: new Date(),
          },
        });

        await notifyOperationalEvent(tx, { entity: "queue", id: queueEntry.id, salonId,
          customerId: user.id, ownerId: salon.ownerId, actorId: user.id, state: "CREATED", revision: "created" });
        return queueEntry;
        });
        return reply.code(201).send({
          ok: true,
          created: true,
          queueEntry,
        });
      } catch (error: any) {
        // The DB partial unique index is the concurrency authority.
        // If another identical request won the race, return that active ticket.
        if (error?.code === "P2002") {
          const concurrentExisting = await prisma.queueEntry.findFirst({
            where: {
              customerId: user.id,
              source: "SALO_TICKET",
              status: { in: ["WAITING", "CALLED"] },
            },
            orderBy: { joinedAt: "asc" },
          });

          if (concurrentExisting) {
            return {
              ok: true,
              created: false,
              queueEntry: concurrentExisting,
            };
          }
        }

        throw error;
      }
    } catch (error: any) {
      if (reply.sent) return reply;
      if (error?.statusCode) {
        return reply.code(error.statusCode).send({ error: error.message });
      }

      return reply.code(500).send({ error: "Operation could not be saved" });
    }
  });

  // OWNER/STAFF: register a walk-in customer (anonymous MANUAL_WALK_IN entry).
  app.post("/api/v1/salons/:salonId/queue/walk-in", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      if (user.role !== "ADMIN" && user.role !== "OWNER" && user.role !== "STAFF") {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const parsed = salonParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid salon id" });
      }

      const { salonId } = parsed.data;

      const salon = await prisma.salon.findUnique({
        where: { id: salonId },
        select: { id: true, ownerId: true, isActive: true, walkInIntakeEnabled: true },
      });

      if (!salon) {
        return reply.code(404).send({ error: "Salon not found" });
      }

      if (user.role === "OWNER" && salon.ownerId !== user.id) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      if (user.role === "STAFF") {
        const membership = await prisma.staffMembership.findFirst({
          where: { salonId, userId: user.id, status: "ACTIVE", revokedAt: null },
          select: { id: true },
        });
        if (!membership) {
          return reply.code(403).send({ error: "Forbidden" });
        }
      }

      const platformSettings = await getPlatformSettings();
      if (!platformSettings.walkInGloballyEnabled || !platformSettings.saloTicketGloballyEnabled) {
        return reply.code(409).send({ error: "Walk-in intake is currently disabled" });
      }

      if (!salon.isActive || !salon.walkInIntakeEnabled) {
        return reply.code(409).send({ error: "Walk-in intake is currently disabled" });
      }

      const queueEntry = await prisma.$transaction(async (tx) => {
        const entry = await tx.queueEntry.create({
          data: {
            salonId,
            source: "MANUAL_WALK_IN",
            status: "WAITING",
            joinedAt: new Date(),
          },
        });

        await notifyOperationalEvent(tx, { entity: "queue", id: entry.id, salonId,
          customerId: null, ownerId: salon.ownerId, actorId: user.id, state: "CREATED", revision: "created" });
        return entry;
      });

      return reply.code(201).send({ ok: true, created: true, queueEntry });
    } catch (error: any) {
      if (reply.sent) return reply;
      if (error?.statusCode) {
        return reply.code(error.statusCode).send({ error: error.message });
      }

      return reply.code(500).send({ error: "Operation could not be saved" });
    }
  });

  // CUSTOMER: read the customer's own current SALO Ticket (real queue values only).
  app.get("/api/v1/queue/tickets/mine", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      requireRole(user, ["CUSTOMER"], reply);

      const include = {
        serviceVisit: { select: { status: true, completedAt: true, cancelledAt: true } },
        salon: { select: { id: true, name: true, slug: true, city: true, address: true, phone: true, saloTicketIntakeEnabled: true, walkInIntakeEnabled: true, isActive: true, openingTime: true, closingTime: true, timeZone: true, workingDays: true } },
      } as const;
      // Prefer the waiting ticket; otherwise show the latest persisted lifecycle,
      // including cancellation and completion of its linked ServiceVisit.
      const waitingTicket = await prisma.queueEntry.findFirst({
        where: {
          customerId: user.id,
          source: "SALO_TICKET",
          status: { in: ["WAITING", "CALLED"] },
        },
        orderBy: [{ joinedAt: "asc" }, { id: "asc" }], include,
      });
      const ticket = waitingTicket || await prisma.queueEntry.findFirst({
        where: { customerId: user.id, source: "SALO_TICKET" },
        orderBy: [{ joinedAt: "desc" }, { id: "desc" }], include,
      });

      reply.header("Cache-Control", "no-store");

      if (!ticket) {
        return {
          ok: true,
          ticket: null,
          active: false,
          position: null,
          ahead: null,
          serverTime: new Date().toISOString(),
        };
      }

      const isBlockingActive = ticket.status === "WAITING" || ticket.status === "CALLED";
      let position: number | null = null;
      let ahead: number | null = null;

      if (isBlockingActive) {
        // Truthful queue position: entries the salon already serves before this one.
        const waitingAhead = await prisma.queueEntry.count({
          where: {
            salonId: ticket.salonId,
            status: { in: ["WAITING", "CALLED"] },
            OR: [{ joinedAt: { lt: ticket.joinedAt } }, { joinedAt: ticket.joinedAt, id: { lt: ticket.id } }],
          },
        });
        ahead = waitingAhead;
        position = waitingAhead + 1;
      }

      const { salon, ...entry } = ticket;

      // Derived SMART wait for the customer's real queue position. Read-only:
      // no countdown is persisted, the estimate is recomputed on every read.
      let wait: ReturnType<typeof projectSmartWaitForPublic> | null = null;
      if (isBlockingActive) {
        const [memberships, serviceRows, platformGates] = await Promise.all([
          prisma.staffMembership.findMany({
            where: { salonId: ticket.salonId, status: "ACTIVE", revokedAt: null },
            include: smartWaitMembershipInclude,
          }),
          prisma.service.findMany({
            where: { salonId: ticket.salonId, isActive: true },
            select: { durationMin: true },
          }),
          getPlatformSettings(),
        ]);

        wait = projectSmartWaitForPublic(computeWaitForSalon({
          salon,
          memberships,
          serviceDurations: (serviceRows || []).map((row: any) => row.durationMin),
          queueLength: null,
          queueAhead: ahead ?? 0,
          platformSettings: platformGates,
          now: Date.now(),
        }));
      }

      return {
        ok: true,
        ticket: { ...entry, salon },
        active: isBlockingActive,
        position,
        ahead,
        wait,
        serverTime: new Date().toISOString(),
      };
    } catch (error: any) {
      if (reply.sent) return reply;
      if (error?.statusCode) {
        return reply.code(error.statusCode).send({ error: error.message });
      }

      request.log?.error?.(error);
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  // CUSTOMER: cancel only their own active SALO Ticket.
  app.post(
    "/api/v1/salons/:salonId/queue/:queueEntryId/cancel",
    async (request: any, reply: any) => {
      try {
        const user = await requireUserFromAuthHeader(request, reply);
        requireRole(user, ["CUSTOMER"], reply);

        const parsed = queueEntryParamsSchema.safeParse(request.params);
        if (!parsed.success) {
          return reply.code(400).send({ error: "Invalid queue entry id" });
        }

        const { salonId, queueEntryId } = parsed.data;

        const queueEntry = await prisma.queueEntry.findUnique({
          where: { id: queueEntryId },
        });

        if (!queueEntry || queueEntry.salonId !== salonId) {
          return reply.code(404).send({ error: "Queue entry not found" });
        }

        if (
          queueEntry.source !== "SALO_TICKET" ||
          queueEntry.customerId !== user.id
        ) {
          return reply.code(403).send({ error: "Forbidden" });
        }

        getQueueTransition(queueEntry.status, "CANCEL");

        const cancelled = await prisma.$transaction(async (tx) => {
        const updated = await tx.queueEntry.updateMany({
          where: {
            id: queueEntry.id,
            version: queueEntry.version,
            status: queueEntry.status,
          },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
            version: { increment: 1 },
          },
        });

        if (updated.count !== 1) {
          throw Object.assign(new Error("Queue entry changed"), { statusCode: 409 });
        }

        const cancelled = await tx.queueEntry.findUnique({
          where: { id: queueEntry.id },
        });

        const salon = await tx.salon.findUniqueOrThrow({ where: { id: salonId } });
        await notifyOperationalEvent(tx, { entity: "queue", id: queueEntry.id, salonId,
          customerId: user.id, ownerId: salon.ownerId, actorId: user.id, state: "CANCELLED", revision: "cancelled" });
        return cancelled;
        });
        return {
          ok: true,
          queueEntry: cancelled,
        };
      } catch (error: any) {
        if (reply.sent) return reply;
        if (error?.message?.startsWith("Invalid queue transition:")) {
          return reply.code(409).send({ error: "Invalid queue transition" });
        }

        if (error?.statusCode) {
          return reply.code(error.statusCode).send({ error: error.message });
        }

        return reply.code(500).send({ error: "Operation could not be saved" });
      }
    },
  );
     app.post(
    "/api/v1/salons/:salonId/queue/:queueEntryId/start",
    async (request: any, reply: any) => {
      try {
        const user = await requireUserFromAuthHeader(request, reply);

        const params = queueEntryParamsSchema.safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send({ error: "Invalid queue entry id" });
        }

        const body = startQueueEntrySchema.safeParse(request.body ?? {});
        if (!body.success) {
          return reply.code(400).send({ error: "Invalid payload" });
        }

        const { salonId, queueEntryId } = params.data;
        const { staffMembershipId } = body.data;

        const salon = await prisma.salon.findUnique({
          where: { id: salonId },
          select: { id: true, ownerId: true },
        });

        if (!salon) {
          return reply.code(404).send({ error: "Salon not found" });
        }

        if (
          user.role !== "ADMIN" &&
          (user.role !== "OWNER" || salon.ownerId !== user.id) &&
          user.role !== "STAFF"
        ) {
          return reply.code(403).send({ error: "Forbidden" });
        }

        const result = await prisma.$transaction(async (tx) => {
          const queueEntry = await tx.queueEntry.findUnique({
            where: { id: queueEntryId },
          });

          if (!queueEntry || queueEntry.salonId !== salonId) {
            throw Object.assign(new Error("Queue entry not found"), {
              statusCode: 404,
            });
          }

          getQueueTransition(queueEntry.status, "START");

          const membership = await tx.staffMembership.findUnique({
            where: { id: staffMembershipId },
            include: {
              presence: {
                include: {
                  leases: true,
                },
              },
            },
          });

          if (!membership || membership.salonId !== salonId) {
            throw Object.assign(new Error("Staff membership not found"), {
              statusCode: 404,
            });
          }

          if (user.role === "STAFF" && membership.userId !== user.id) {
            throw Object.assign(
              new Error("Staff can only start their own queue entries"),
              { statusCode: 403 },
            );
          }

          const presenceState = resolveEffectiveStaffPresence(
            membership,
            membership.presence,
          );

          const validStartContext = isValidServiceVisitStartContext({
            source: "WALK_IN",
            salonId,
            bookingId: null,
            bookingSalonId: null,
            staffMembershipId,
            membershipId: membership.id,
            membershipSalonId: membership.salonId,
            membershipStatus: membership.status,
            membershipRevokedAt: membership.revokedAt,
            presenceState,
          });

          if (!validStartContext) {
            throw Object.assign(
              new Error("Staff member is not available for service"),
              { statusCode: 409 },
            );
          }

          const startedAt = new Date();

          const serviceVisit = await tx.serviceVisit.create({
            data: {
              salonId,
              bookingId: null,
              staffMembershipId,
              source: "WALK_IN",
              status: "IN_SERVICE",
              startedAt,
              startedByUserId: user.id,
            },
          });

          const updated = await tx.queueEntry.updateMany({
            where: {
              id: queueEntry.id,
              version: queueEntry.version,
              status: queueEntry.status,
            },
            data: {
              status: "STARTED",
              startedAt,
              serviceVisitId: serviceVisit.id,
              version: { increment: 1 },
            },
          });

          if (updated.count !== 1) {
            throw Object.assign(new Error("Queue entry changed"), {
              statusCode: 409,
            });
          }

          const startedQueueEntry = await tx.queueEntry.findUnique({
            where: { id: queueEntry.id },
          });

          await notifyOperationalEvent(tx, { entity: "queue", id: queueEntry.id, salonId,
            customerId: queueEntry.customerId, ownerId: salon.ownerId, actorId: user.id, state: "STARTED", revision: "started" });
          return {
            queueEntry: startedQueueEntry,
            serviceVisit,
          };
        });

        return {
          ok: true,
          ...result,
        };
      } catch (error: any) {
        if (reply.sent) return reply;
        if (error?.message?.startsWith("Invalid queue transition:")) {
          return reply.code(409).send({ error: "Invalid queue transition" });
        }

        if (error?.statusCode) {
          return reply.code(error.statusCode).send({ error: error.message });
        }

        request.log?.error?.(error);
        return reply.code(500).send({ error: "Internal server error" });
      }
    },
  );
}
