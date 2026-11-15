import { earnCompletedServiceVisit } from "../lib/loyalty-ledger.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { requireUserFromAuthHeader } from "../lib/auth.js";
import { getPlatformSettings } from "../lib/platform-settings.js";
import { prisma } from "../lib/prisma.js";
import { resolveEffectiveStaffPresence } from "../lib/staff-presence.js";
import { deriveStaffOccupancy, isValidServiceVisitStartContext, isAllowedServiceVisitTransition } from "../lib/service-visit.js";
import { loadLiveStatuses } from "../lib/smart-wait-data.js";

const salonParamsSchema = z.object({ salonId: z.string().min(1) });
const liveStatusBatchSchema = z.object({ salonIds: z.string().min(1) });
const LIVE_STATUS_BATCH_LIMIT = 24;
const staffParamsSchema = z.object({ salonId: z.string().min(1), staffMembershipId: z.string().min(1) });
const visitParamsSchema = z.object({ salonId: z.string().min(1), visitId: z.string().min(1) });

const dutyToggleSchema = z.object({
  dutyState: z.enum(["ON_DUTY", "OFF_DUTY"]),
}).strict();

const startVisitSchema = z.object({
  staffMembershipId: z.string().min(1),
  source: z.enum(["WALK_IN", "BOOKING"]).default("WALK_IN"),
  bookingId: z.string().min(1).optional(),
}).strict();

const LEASE_TTL_MS = 5 * 60 * 1000;

async function verifySalonAccess(user: any, salonId: string, reply: any) {
  const salon = await prisma.salon.findUnique({ where: { id: salonId }, select: { id: true, ownerId: true, walkInIntakeEnabled: true } });
  if (!salon) { reply.code(404).send({ error: "Salon not found" }); return null; }
  if (user.role !== "ADMIN" && (user.role !== "OWNER" || salon.ownerId !== user.id) && user.role !== "STAFF") {
    reply.code(403).send({ error: "Forbidden" }); return null;
  }
  if (user.status !== "ACTIVE") { reply.code(403).send({ error: "Forbidden" }); return null; }
  if (user.role === "STAFF") {
    const membership = await prisma.staffMembership.findUnique({ where: { userId_salonId: { userId: user.id, salonId } } });
    if (!membership || membership.status !== "ACTIVE" || membership.revokedAt !== null) {
      reply.code(403).send({ error: "Forbidden" }); return null;
    }
  }
  return salon;
}

async function loadStaffContext(tx: any, salonId: string, staffMembershipId: string) {
  const membership = await tx.staffMembership.findUnique({
    where: { id: staffMembershipId },
    include: { presence: { include: { leases: true } }, barber: true, user: true,
      serviceVisits: { where: { status: "IN_SERVICE" }, take: 1 } },
  });
  if (!membership || membership.salonId !== salonId) return null;
  return membership;
}

export async function staffStatusRoutes(app: any) {
  app.get("/api/v1/salons/:salonId/staff/status", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const params = salonParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid salon id" });
      const salon = await verifySalonAccess(user, params.data.salonId, reply);
      if (!salon) return reply;

      const serverNow = Date.now();
      const memberships = await prisma.staffMembership.findMany({
        where: { salonId: salon.id, status: "ACTIVE", revokedAt: null },
        include: {
          presence: { include: { leases: true } },
          barber: true,
          user: { select: { id: true, fullName: true } },
          serviceVisits: { where: { status: "IN_SERVICE" }, take: 1 },
        },
      });

      const staff = memberships.map((m) => {
        const presenceState = resolveEffectiveStaffPresence(m, m.presence, serverNow);
        const hasActiveVisit = m.serviceVisits.length > 0;
        const occupancy = deriveStaffOccupancy(presenceState, hasActiveVisit);
        return {
          staffMembershipId: m.id,
          barberId: m.barberId,
          barberName: m.barber.name,
          userId: m.userId,
          userName: m.user.fullName,
          occupancy,
          presenceState,
          hasActiveVisit,
          activeVisitId: hasActiveVisit ? m.serviceVisits[0].id : null,
          changedAt: m.presence?.changedAt ?? null,
        };
      });

      reply.header("Cache-Control", "no-store");
      return { staff, expiresAt: new Date(Math.min(serverNow + 15000, ...memberships.flatMap(m => m.presence?.leases.filter(l => l.generation === m.presence?.generation && !l.revokedAt && l.observedAt.getTime() <= serverNow && l.validUntil.getTime() > serverNow).map(l => l.validUntil.getTime()) ?? []))).toISOString() };
    } catch (error: any) {
      if (error?.statusCode) return reply.code(error.statusCode).send({ error: error.message });
      if (reply.sent) return reply;
      request.log?.error?.(error);
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  app.patch("/api/v1/salons/:salonId/staff/:staffMembershipId/duty", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const params = staffParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid parameters" });
      const body = dutyToggleSchema.safeParse(request.body ?? {});
      if (!body.success) return reply.code(400).send({ error: "Invalid payload", details: body.error.flatten() });

      const salon = await verifySalonAccess(user, params.data.salonId, reply);
      if (!salon) return reply;

      const liveSettings = await getPlatformSettings();
      if (!liveSettings.staffStatusLiveEnabled) {
        return reply.code(409).send({ error: "Live staff status is currently disabled" });
      }

      const { salonId, staffMembershipId } = params.data;
      const { dutyState } = body.data;

      const membership = await loadStaffContext(prisma, salonId, staffMembershipId);
      if (!membership || membership.status !== "ACTIVE" || membership.revokedAt !== null) return reply.code(404).send({ error: "Staff membership not found" });

      if (user.role === "STAFF" && membership.userId !== user.id) {
        return reply.code(403).send({ error: "Staff can only manage their own duty state" });
      }

      const now = new Date();
      const changeSource = user.role === "OWNER" || user.role === "ADMIN" ? "OWNER" : "STAFF";

      const result = await prisma.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT "id" FROM "StaffMembership" WHERE "id" = ${staffMembershipId} FOR UPDATE`;
        const existingPresence = await tx.staffPresence.findUnique({ where: { staffMembershipId } });

        if (dutyState === "ON_DUTY") {
          const newGeneration = (existingPresence?.generation ?? 0) + 1;

          const presence = await tx.staffPresence.upsert({
            where: { staffMembershipId },
            update: { dutyState: "ON_DUTY", generation: newGeneration, changedAt: now, changedByUserId: user.id, changeSource },
            create: { staffMembershipId, dutyState: "ON_DUTY", generation: newGeneration, changedAt: now, changedByUserId: user.id, changeSource },
          });

          const leaseKey = randomUUID();
          await tx.staffPresenceLease.create({
            data: {
              staffMembershipId,
              generation: newGeneration,
              evidenceSource: changeSource === "OWNER" ? "OWNER" : "STAFF_APP",
              producerKey: leaseKey,
              observedAt: now,
              validUntil: new Date(now.getTime() + LEASE_TTL_MS),
            },
          });

          return { dutyState: "ON_DUTY", generation: newGeneration, changedAt: now };
        } else {
          if (!existingPresence) {
            throw Object.assign(new Error("No active presence to turn off"), { statusCode: 409 });
          }

          await tx.staffPresence.update({
            where: { staffMembershipId },
            data: { dutyState: "OFF_DUTY", changedAt: now, changedByUserId: user.id, changeSource },
          });

          await tx.staffPresenceLease.updateMany({
            where: { staffMembershipId, revokedAt: null },
            data: { revokedAt: now },
          });

          return { dutyState: "OFF_DUTY", changedAt: now };
        }
      });

      const updatedMembership = await loadStaffContext(prisma, salonId, staffMembershipId);
      const presenceState = resolveEffectiveStaffPresence(updatedMembership, updatedMembership?.presence, Date.now());
      const hasActiveVisit = (updatedMembership?.serviceVisits?.length ?? 0) > 0;
      const occupancy = deriveStaffOccupancy(presenceState, hasActiveVisit);

      return { ok: true, ...result, presenceState, occupancy };
    } catch (error: any) {
      if (error?.statusCode) return reply.code(error.statusCode).send({ error: error.message });
      if (reply.sent) return reply;
      if (error?.code === "P2002" || error?.code === "P2025") return reply.code(409).send({ error: "Staff state changed; refresh and retry" });
      request.log?.error?.(error);
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  app.post("/api/v1/salons/:salonId/staff/:staffMembershipId/presence/confirm", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const params = staffParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid parameters" });

      const salon = await verifySalonAccess(user, params.data.salonId, reply);
      if (!salon) return reply;

      const { salonId, staffMembershipId } = params.data;
      const membership = await loadStaffContext(prisma, salonId, staffMembershipId);
      if (!membership || membership.status !== "ACTIVE" || membership.revokedAt !== null) return reply.code(404).send({ error: "Staff membership not found" });

      if (user.role === "STAFF" && membership.userId !== user.id) {
        return reply.code(403).send({ error: "Staff can only confirm their own presence" });
      }

      const presence = await prisma.staffPresence.findUnique({ where: { staffMembershipId } });
      if (!presence || presence.dutyState !== "ON_DUTY") {
        return reply.code(409).send({ error: "Staff member is not ON_DUTY" });
      }

      const now = new Date();
      const changeSource = user.role === "STAFF" ? "STAFF_APP" : "OWNER";
      const leaseKey = randomUUID();

      await prisma.staffPresenceLease.create({
        data: {
          staffMembershipId,
          generation: presence.generation,
          evidenceSource: changeSource,
          producerKey: leaseKey,
          observedAt: now,
          validUntil: new Date(now.getTime() + LEASE_TTL_MS),
        },
      });

      const updatedMembership = await loadStaffContext(prisma, salonId, staffMembershipId);
      const presenceState = resolveEffectiveStaffPresence(updatedMembership, updatedMembership?.presence, Date.now());
      const hasActiveVisit = (updatedMembership?.serviceVisits?.length ?? 0) > 0;
      const occupancy = deriveStaffOccupancy(presenceState, hasActiveVisit);

      return { ok: true, presenceState, occupancy, confirmedAt: now, validUntil: new Date(now.getTime() + LEASE_TTL_MS) };
    } catch (error: any) {
      if (error?.statusCode) return reply.code(error.statusCode).send({ error: error.message });
      if (reply.sent) return reply;
      if (error?.code === "P2002" || error?.code === "P2025") return reply.code(409).send({ error: "Staff state changed; refresh and retry" });
      request.log?.error?.(error);
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  app.post("/api/v1/salons/:salonId/service-visits", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const params = salonParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid salon id" });
      const body = startVisitSchema.safeParse(request.body ?? {});
      if (!body.success) return reply.code(400).send({ error: "Invalid payload", details: body.error.flatten() });

      const salon = await verifySalonAccess(user, params.data.salonId, reply);
      if (!salon) return reply;

      const settings = await getPlatformSettings();

      const { salonId } = params.data;
      const { staffMembershipId, source, bookingId } = body.data;

      if (source === "WALK_IN") {
        if (!settings.walkInGloballyEnabled) {
          return reply.code(409).send({ error: "Walk-in intake is currently disabled" });
        }
        if (salon.walkInIntakeEnabled === false) {
          return reply.code(409).send({ error: "Walk-in intake is currently disabled" });
        }
      }

      const result = await prisma.$transaction(async (tx: any) => {
        const membership = await tx.staffMembership.findUnique({
          where: { id: staffMembershipId },
          include: { presence: { include: { leases: true } } },
        });

        if (!membership || membership.salonId !== salonId) {
          throw Object.assign(new Error("Staff membership not found"), { statusCode: 404 });
        }

        if (user.role === "STAFF" && membership.userId !== user.id) {
          throw Object.assign(new Error("Staff can only start their own visits"), { statusCode: 403 });
        }
        const presenceState = resolveEffectiveStaffPresence(membership, membership.presence, Date.now());

        let bookingSalonId: string | null = null;
        if (source === "BOOKING" && bookingId) {
          // Keep status/assignment stable until visit creation commits, and read
          // fresh values after any competing booking update releases its lock.
          await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${bookingId} AND "salonId" = ${salonId} FOR UPDATE`;
          const booking = await tx.booking.findUnique({ where: { id: bookingId } });
          bookingSalonId = booking?.salonId ?? null;
          if (!booking || booking.salonId !== salonId) {
            throw Object.assign(new Error("Booking is not available for service"), { statusCode: 409 });
          }
          // Preserve both existing active booking states; do not add a new
          // confirmation prerequisite or change the booking's status here.
          if (booking.status !== "PENDING" && booking.status !== "CONFIRMED") {
            throw Object.assign(new Error("Booking status does not allow service start"), { statusCode: 409 });
          }
          if (booking.barberId !== null && booking.barberId !== membership.barberId) {
            throw Object.assign(new Error("Booking is assigned to a different barber"), { statusCode: 403 });
          }
        }

        const validContext = isValidServiceVisitStartContext({
          source,
          salonId,
          bookingId: bookingId ?? null,
          bookingSalonId,
          staffMembershipId,
          membershipId: membership.id,
          membershipSalonId: membership.salonId,
          membershipStatus: membership.status,
          membershipRevokedAt: membership.revokedAt,
          presenceState,
        });

        if (!validContext) {
          throw Object.assign(new Error("Staff member is not available for service"), { statusCode: 409 });
        }

        const startedAt = new Date();
        const serviceVisit = await tx.serviceVisit.create({
          data: {
            salonId,
            bookingId: bookingId ?? null,
            staffMembershipId,
            source,
            status: "IN_SERVICE",
            startedAt,
            startedByUserId: user.id,
          },
        });

        return serviceVisit;
      });

      return { ok: true, serviceVisit: result };
    } catch (error: any) {
      if (error?.statusCode) return reply.code(error.statusCode).send({ error: error.message });
      if (reply.sent) return reply;
      if (error?.code === "P2002" || error?.code === "P2025") return reply.code(409).send({ error: "Staff state changed; refresh and retry" });
      request.log?.error?.(error);
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  app.patch("/api/v1/salons/:salonId/service-visits/:visitId/complete", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const params = visitParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid parameters" });

      const salon = await verifySalonAccess(user, params.data.salonId, reply);
      if (!salon) return reply;

      const { salonId, visitId } = params.data;

      const result = await prisma.$transaction(async (tx: any) => {
        const visit = await tx.serviceVisit.findUnique({
          where: { id: visitId },
          include: { staffMembership: true },
        });

        if (!visit || visit.salonId !== salonId) {
          throw Object.assign(new Error("Service visit not found"), { statusCode: 404 });
        }

        if (user.role === "STAFF") {
          const membership = await tx.staffMembership.findUnique({ where: { userId_salonId: { userId: user.id, salonId } } });
          if (!membership || membership.status !== "ACTIVE" || membership.revokedAt !== null || membership.id !== visit.staffMembershipId) {
            throw Object.assign(new Error("Staff can only complete their own visits"), { statusCode: 403 });
          }
        }

        if (!isAllowedServiceVisitTransition(visit.status, "COMPLETED")) {
          throw Object.assign(new Error("Visit cannot be completed from its current status"), { statusCode: 409 });
        }

        const completedAt = new Date();
        const updated = await tx.serviceVisit.update({
          where: { id: visitId, version: visit.version },
          data: { status: "COMPLETED", completedAt, completedByUserId: user.id, version: { increment: 1 } },
        });

        if (!updated) {
          throw Object.assign(new Error("Concurrent modification detected"), { statusCode: 409 });
        }

        await earnCompletedServiceVisit(tx, updated);
        return updated;
      });

      const updatedMembership = await loadStaffContext(prisma, salonId, result.staffMembershipId);
      const presenceState = resolveEffectiveStaffPresence(updatedMembership, updatedMembership?.presence, Date.now());
      const hasActiveVisit = (updatedMembership?.serviceVisits?.length ?? 0) > 0;
      const occupancy = deriveStaffOccupancy(presenceState, hasActiveVisit);

      return { ok: true, serviceVisit: result, occupancy };
    } catch (error: any) {
      if (error?.statusCode) return reply.code(error.statusCode).send({ error: error.message });
      if (reply.sent) return reply;
      if (error?.code === "P2002" || error?.code === "P2025") return reply.code(409).send({ error: "Staff state changed; refresh and retry" });
      request.log?.error?.(error);
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  app.get("/api/v1/salons/:salonId/live-status", async (request: any, reply: any) => {
    try {
      const parsed = salonParamsSchema.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid salon id" });

      const serverNow = Date.now();
      const { statuses, notFound } = await loadLiveStatuses(prisma, [parsed.data.salonId], serverNow);
      if (notFound.length > 0 || statuses.length === 0) {
        return reply.code(404).send({ error: "Salon not found" });
      }

      reply.header("Cache-Control", "no-store");
      return statuses[0];
    } catch (error: any) {
      if (reply.sent) return reply;
      if (error?.code === "P2002" || error?.code === "P2025") return reply.code(409).send({ error: "Staff state changed; refresh and retry" });
      request.log?.error?.(error);
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  // Batched public SMART live status. A fixed number of queries for up to
  // LIVE_STATUS_BATCH_LIMIT salons, so a directory page never triggers one
  // independent database waterfall per salon card.
  app.get("/api/v1/salons/live-status", async (request: any, reply: any) => {
    try {
      const parsed = liveStatusBatchSchema.safeParse(request.query ?? {});
      if (!parsed.success) return reply.code(400).send({ error: "Invalid salon ids" });

      const ids = Array.from(new Set(
        parsed.data.salonIds.split(",").map((id) => id.trim()).filter(Boolean),
      ));
      if (ids.length === 0) return reply.code(400).send({ error: "Invalid salon ids" });
      if (ids.length > LIVE_STATUS_BATCH_LIMIT) {
        return reply.code(400).send({ error: `At most ${LIVE_STATUS_BATCH_LIMIT} salon ids per request` });
      }

      const serverNow = Date.now();
      const { statuses, notFound } = await loadLiveStatuses(prisma, ids, serverNow);

      reply.header("Cache-Control", "no-store");
      return {
        observedAt: new Date(serverNow).toISOString(),
        salons: statuses,
        notFound,
      };
    } catch (error: any) {
      if (reply.sent) return reply;
      if (error?.code === "P2002" || error?.code === "P2025") return reply.code(409).send({ error: "Staff state changed; refresh and retry" });
      request.log?.error?.(error);
      return reply.code(500).send({ error: "Internal server error" });
    }
  });
}
