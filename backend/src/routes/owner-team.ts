import { z } from "zod";

import { hashPassword, requireUserFromAuthHeader } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

const salonParamsSchema = z.object({ salonId: z.string().uuid() });

const inviteStaffSchema = z.object({
  email: z.string().trim().email(),
  fullName: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(7).max(40).optional().or(z.literal("")),
  password: z.string().min(8).max(128),
  barberName: z.string().trim().min(1).max(80),
}).strict();

const membershipParamsSchema = z.object({
  salonId: z.string().uuid(),
  membershipId: z.string().uuid(),
});

async function requireOwnerSalonAccess(user: any, salonId: string, reply: any) {
  if (user.role !== "OWNER" && user.role !== "ADMIN") {
    reply.code(403).send({ error: "Forbidden" });
    return null;
  }
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { id: true, ownerId: true, name: true },
  });
  if (!salon) {
    reply.code(404).send({ error: "Salon not found" });
    return null;
  }
  if (user.role !== "ADMIN" && salon.ownerId !== user.id) {
    reply.code(403).send({ error: "Forbidden" });
    return null;
  }
  return salon;
}

async function requireQueueSalonAccess(user: any, salonId: string, reply: any) {
  if (user.role !== "STAFF") return requireOwnerSalonAccess(user, salonId, reply);

  const membership = await prisma.staffMembership.findFirst({
    where: { salonId, userId: user.id, status: "ACTIVE", revokedAt: null },
    select: { salonId: true },
  });
  if (!membership) {
    reply.code(403).send({ error: "Forbidden" });
    return null;
  }
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { id: true, ownerId: true, name: true },
  });
  if (!salon) {
    reply.code(404).send({ error: "Salon not found" });
    return null;
  }
  return salon;
}

export async function ownerTeamRoutes(app: any) {
  // GET: list salon staff
  app.get("/api/v1/salons/:salonId/team", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const params = salonParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid salon id" });

      const salon = await requireOwnerSalonAccess(user, params.data.salonId, reply);
      if (!salon) return;

      const { resolveEffectiveStaffPresence } = await import("../lib/staff-presence.js");
      const { deriveStaffOccupancy } = await import("../lib/service-visit.js");

      const memberships = await prisma.staffMembership.findMany({
        where: { salonId: salon.id },
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, fullName: true, email: true, phone: true, role: true, status: true } },
          barber: { select: { id: true, name: true, specialty: true, isActive: true } },
          presence: { include: { leases: true } },
          serviceVisits: { where: { status: "IN_SERVICE" }, take: 1 },
        },
      });

      const serverNow = Date.now();
      const team = memberships.map((m: any) => {
        const presenceState = resolveEffectiveStaffPresence(m, m.presence, serverNow);
        const hasActiveVisit = m.serviceVisits.length > 0;
        const occupancy = deriveStaffOccupancy(presenceState, hasActiveVisit);
        return {
          membershipId: m.id,
          userId: m.userId,
          barberId: m.barberId,
          status: m.status,
          revokedAt: m.revokedAt,
          createdAt: m.createdAt,
          user: m.user,
          barber: m.barber,
          presenceState,
          occupancy,
          hasActiveVisit,
          activeVisitId: hasActiveVisit ? m.serviceVisits[0].id : null,
        };
      });

      reply.header("Cache-Control", "no-store");
      return { team };
    } catch (error: any) {
      if (error?.statusCode) return reply.code(error.statusCode).send({ error: error.message });
      if (reply.sent) return reply;
      request.log?.error?.(error);
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  // POST: add staff member
  app.post("/api/v1/salons/:salonId/team", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const params = salonParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid salon id" });

      const salon = await requireOwnerSalonAccess(user, params.data.salonId, reply);
      if (!salon) return;

      const parsed = inviteStaffSchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });

      const { email, fullName, phone, password, barberName } = parsed.data;
      const normalizedEmail = email.trim().toLowerCase();

      const result = await prisma.$transaction(async (tx: any) => {
        let staffUser = await tx.user.findUnique({ where: { email: normalizedEmail } });

        if (!staffUser) {
          const passwordHash = await hashPassword(password);
          staffUser = await tx.user.create({
            data: {
              fullName: fullName.trim(),
              email: normalizedEmail,
              phone: phone?.trim() || null,
              passwordHash,
              role: "STAFF",
              status: "ACTIVE",
              emailVerified: true,
            },
          });
        } else {
          if (staffUser.role !== "STAFF") {
            throw Object.assign(new Error("User already has a non-STAFF role"), { statusCode: 409 });
          }
        }

        const existingMembership = await tx.staffMembership.findFirst({
          where: { userId: staffUser.id, salonId: salon.id },
        });

        if (existingMembership) {
          if (existingMembership.status === "REVOKED") {
            throw Object.assign(new Error("Staff membership was revoked"), { statusCode: 409 });
          }
          throw Object.assign(new Error("Staff member already belongs to this salon"), { statusCode: 409 });
        }

        const barber = await tx.barber.create({
          data: { salonId: salon.id, name: barberName.trim(), isActive: true },
        });

        const membership = await tx.staffMembership.create({
          data: { userId: staffUser.id, salonId: salon.id, barberId: barber.id, status: "ACTIVE" },
          include: {
            user: { select: { id: true, fullName: true, email: true, phone: true, role: true, status: true } },
            barber: { select: { id: true, name: true, isActive: true } },
          },
        });

        return { user: staffUser, membership };
      });

      return reply.code(201).send({
        ok: true,
        user: { id: result.user.id, fullName: result.user.fullName, email: result.user.email, role: result.user.role },
        membership: {
          id: result.membership.id,
          userId: result.membership.userId,
          barberId: result.membership.barberId,
          status: result.membership.status,
          barber: result.membership.barber,
        },
      });
    } catch (error: any) {
      if (error?.statusCode) return reply.code(error.statusCode).send({ error: error.message });
      if (reply.sent) return reply;
      if (error?.code === "P2002") return reply.code(409).send({ error: "Conflict detected" });
      request.log?.error?.(error);
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  // PATCH: activate/suspend membership
  app.patch("/api/v1/salons/:salonId/team/:membershipId", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const params = membershipParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid parameters" });

      const salon = await requireOwnerSalonAccess(user, params.data.salonId, reply);
      if (!salon) return;

      const body = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) }).strict().safeParse(request.body ?? {});
      if (!body.success) return reply.code(400).send({ error: "Invalid payload" });

      const membership = await prisma.staffMembership.findUnique({ where: { id: params.data.membershipId } });
      if (!membership || membership.salonId !== salon.id) {
        return reply.code(404).send({ error: "Staff membership not found" });
      }
      if (membership.status === "REVOKED") {
        return reply.code(409).send({ error: "Cannot change status of a revoked membership" });
      }

      const updated = await prisma.staffMembership.update({
        where: { id: membership.id },
        data: {
          status: body.data.status,
          revokedAt: body.data.status === "SUSPENDED" ? new Date() : null,
        },
        include: {
          user: { select: { id: true, fullName: true, email: true } },
          barber: { select: { id: true, name: true } },
        },
      });

      if (body.data.status === "SUSPENDED") {
        await prisma.staffPresenceLease.updateMany({
          where: { staffMembershipId: membership.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      return { ok: true, membership: { id: updated.id, status: updated.status, user: updated.user, barber: updated.barber } };
    } catch (error: any) {
      if (error?.statusCode) return reply.code(error.statusCode).send({ error: error.message });
      if (reply.sent) return reply;
      request.log?.error?.(error);
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  // DELETE: revoke membership
  app.delete("/api/v1/salons/:salonId/team/:membershipId", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const params = membershipParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid parameters" });

      const salon = await requireOwnerSalonAccess(user, params.data.salonId, reply);
      if (!salon) return;

      const membership = await prisma.staffMembership.findUnique({
        where: { id: params.data.membershipId },
        include: { serviceVisits: { where: { status: "IN_SERVICE" }, take: 1 } },
      });

      if (!membership || membership.salonId !== salon.id) {
        return reply.code(404).send({ error: "Staff membership not found" });
      }

      if (membership.serviceVisits.length > 0) {
        return reply.code(409).send({ error: "Cannot revoke staff with active service visit" });
      }

      await prisma.$transaction(async (tx: any) => {
        await tx.staffPresenceLease.updateMany({
          where: { staffMembershipId: membership.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.staffPresence.deleteMany({ where: { staffMembershipId: membership.id } });
        await tx.staffMembership.update({
          where: { id: membership.id },
          data: { status: "REVOKED", revokedAt: new Date() },
        });
      });

      return { ok: true, membershipId: membership.id, status: "REVOKED" };
    } catch (error: any) {
      if (error?.statusCode) return reply.code(error.statusCode).send({ error: error.message });
      if (reply.sent) return reply;
      request.log?.error?.(error);
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  // GET: queue for owner salon (readable by owner/admin and by active salon staff)
  app.get("/api/v1/salons/:salonId/queue", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const params = salonParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid salon id" });

      const salon = await requireQueueSalonAccess(user, params.data.salonId, reply);
      if (!salon) return;

      const entries = await prisma.queueEntry.findMany({
        where: { salonId: salon.id, status: { in: ["WAITING", "CALLED"] } },
        orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
        include: {
          customer: { select: { id: true, fullName: true, phone: true } },
          serviceVisit: true,
        },
      });

      reply.header("Cache-Control", "no-store");
      return { queue: entries.map((e: any) => ({
        id: e.id,
        source: e.source,
        status: e.status,
        joinedAt: e.joinedAt,
        calledAt: e.calledAt,
        startedAt: e.startedAt,
        customer: e.customer ? { id: e.customer.id, name: e.customer.fullName, phone: e.customer.phone } : null,
        version: e.version,
      }))};
    } catch (error: any) {
      if (error?.statusCode) return reply.code(error.statusCode).send({ error: error.message });
      if (reply.sent) return reply;
      request.log?.error?.(error);
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  // GET: staff self info
  app.get("/api/v1/staff/me", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      if (user.role !== "STAFF") return reply.code(403).send({ error: "Forbidden" });

      const { resolveEffectiveStaffPresence } = await import("../lib/staff-presence.js");
      const { deriveStaffOccupancy } = await import("../lib/service-visit.js");

      const memberships = await prisma.staffMembership.findMany({
        where: { userId: user.id, status: "ACTIVE", revokedAt: null },
        include: {
          salon: { select: { id: true, name: true, city: true, phone: true, address: true } },
          barber: { select: { id: true, name: true } },
          presence: { include: { leases: true } },
          serviceVisits: { where: { status: "IN_SERVICE" }, take: 1 },
        },
      });

      if (memberships.length === 0) {
        return reply.code(404).send({ error: "No active staff membership found" });
      }

      const m = memberships[0];
      const serverNow = Date.now();
      const presenceState = resolveEffectiveStaffPresence(m, m.presence, serverNow);
      const hasActiveVisit = m.serviceVisits.length > 0;
      const occupancy = deriveStaffOccupancy(presenceState, hasActiveVisit);

      reply.header("Cache-Control", "no-store");
      return {
        user: { id: user.id, fullName: user.fullName, email: user.email, role: user.role },
        membership: {
          id: m.id,
          salonId: m.salonId,
          barberId: m.barberId,
          status: m.status,
          salon: m.salon,
          barber: m.barber,
        },
        presenceState,
        occupancy,
        hasActiveVisit,
        activeVisitId: hasActiveVisit ? m.serviceVisits[0].id : null,
        activeVisitStartedAt: hasActiveVisit ? m.serviceVisits[0].startedAt : null,
        serverTime: new Date(serverNow).toISOString(),
      };
    } catch (error: any) {
      if (error?.statusCode) return reply.code(error.statusCode).send({ error: error.message });
      if (reply.sent) return reply;
      request.log?.error?.(error);
      return reply.code(500).send({ error: "Internal server error" });
    }
  });
}
