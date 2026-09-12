import { z } from "zod";

import { requireRole, requireUserFromAuthHeader } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { getQueueTransition } from "../lib/queue-entry.js";
import { resolveEffectiveStaffPresence } from "../lib/staff-presence.js";
import { isValidServiceVisitStartContext } from "../lib/service-visit.js";
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
},
      });

      if (!salon) {
        return reply.code(404).send({ error: "Salon not found" });
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
if (!salon.saloTicketIntakeEnabled) {
  return reply.code(409).send({
    error: "SALO Ticket intake is currently disabled",
  });
}
      try {
        const queueEntry = await prisma.queueEntry.create({
          data: {
            salonId,
            customerId: user.id,
            source: "SALO_TICKET",
            status: "WAITING",
            joinedAt: new Date(),
          },
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
      if (error?.statusCode) {
        return reply.code(error.statusCode).send({ error: error.message });
      }

      return reply.code(401).send({ error: "Unauthorized" });
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

        const updated = await prisma.queueEntry.updateMany({
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
          return reply.code(409).send({ error: "Queue entry changed" });
        }

        const cancelled = await prisma.queueEntry.findUnique({
          where: { id: queueEntry.id },
        });

        return {
          ok: true,
          queueEntry: cancelled,
        };
      } catch (error: any) {
        if (error?.message?.startsWith("Invalid queue transition:")) {
          return reply.code(409).send({ error: "Invalid queue transition" });
        }

        if (error?.statusCode) {
          return reply.code(error.statusCode).send({ error: error.message });
        }

        return reply.code(401).send({ error: "Unauthorized" });
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
          (user.role !== "OWNER" || salon.ownerId !== user.id)
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