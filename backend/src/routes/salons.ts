import { z } from "zod";
import { Prisma } from "@prisma/client";

import { prisma } from "../lib/prisma.js";
import { hashPassword, requireRole, requireUserFromAuthHeader } from "../lib/auth.js";
import { normalizeOfferInput } from "../lib/offer.js";
import { salonImageUrlSchema, serializeSalonMedia, syncSalonPrimaryImage } from "../lib/salon-media.js";
import {
  buildPublicSalonState,
  getAutoVipSalonIds,
  getManualVipFlag,
  getManualVipSalonIds,
  MAX_ADMIN_VIP_SLOTS,
  normalizeSalonClassification,
} from "../lib/salon-vip.js";
import { normalizeServiceInput } from "../lib/service.js";
import { salonScheduleFields } from "../lib/salon-schedule.js";
import { projectPublicLiveStatus, publicLiveStatusSelect } from "../lib/salon-live-status.js";
import { normalizeSubscriptionPlan, SUBSCRIPTION_PLAN_ORDER } from "../lib/subscription-plan.js";
import { loadSalonArchiveState } from "../lib/salon-archive-source.js";
import { evaluateSalonDeletionReadiness, hasCurrentSalonArchiveCoverage, revalidateSalonPurgeClearance } from "../lib/salon-clearance-revalidation.js";
const intakeControlsPatchSchema = z.object({
  bookingIntakeEnabled: z.boolean().optional(),
  saloTicketIntakeEnabled: z.boolean().optional(),
  walkInIntakeEnabled: z.boolean().optional(),
}).strict().refine((data) => Object.values(data).some((value) => value !== undefined), {
  message: "At least one intake control is required",
});

const salonClassificationSchema = z.enum(["REGULAR", "PREMIUM"]).optional();

const salonEnforcementSchema = z.object({
  reason: z.string().trim().min(1),
}).strict();

const salonSchema = z.object({
  name: z.string().min(2),
  city: z.string().min(2),
  address: z.string().min(5),
  phone: z.string().min(7),
  email: z.string().email().optional(),
  website: z.string().url().optional(),
  description: z.string().optional(),
  isVip: z.boolean().optional(),
  adminVip: z.boolean().optional(),
  classification: salonClassificationSchema,
  isWomenOnly: z.boolean().optional(),
  ...salonScheduleFields,
  imageUrl: salonImageUrlSchema,
});

const salonPatchSchema = salonSchema.partial().extend({
  isActive: z.boolean().optional(),
  ownerPassword: z.string().trim().min(8).max(128).optional().or(z.literal("")),
});

const servicePriceSchema = z.union([
  z.number().finite().min(0).max(99999999.99),
  z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/).transform(Number),
]);

const serviceSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(240).optional().or(z.literal("")),
  price: servicePriceSchema.optional(),
  durationMin: z.union([z.number(), z.string()]).optional(),
  isActive: z.boolean().optional(),
});

const serviceCreateSchema = serviceSchema.extend({
  name: z.string().trim().min(1).max(80),
  price: servicePriceSchema,
});

const offerSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  price: z.union([z.number(), z.string()]).optional(),
  discount: z.union([z.number(), z.string()]).optional(),
  serviceName: z.string().trim().max(80).optional().or(z.literal("")),
  startAt: z.union([z.string(), z.date()]).optional().nullable(),
  endAt: z.union([z.string(), z.date()]).optional().nullable(),
  startTime: z.string().trim().max(16).optional().or(z.literal("")),
  endTime: z.string().trim().max(16).optional().or(z.literal("")),
  availableSlots: z.union([z.number(), z.string()]).optional(),
  isActive: z.boolean().optional(),
});

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional().or(z.literal("")),
});

function serializeService(service: any) {
  return {
    id: service.id,
    salonId: service.salonId,
    name: service.name,
    description: service.description,
    durationMin: Number(service.durationMin ?? 30),
    price: Number(service.price ?? 0),
    isActive: service.isActive ?? true,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  };
}

function serializeOffer(offer: any) {
  return {
    id: offer.id,
    salonId: offer.salonId,
    title: offer.title,
    description: offer.description,
    price: Number(offer.price ?? 0),
    discount: Number(offer.discount ?? 0),
    serviceName: offer.serviceName ?? null,
    availableSlots: Number(offer.availableSlots ?? 0),
    startAt: offer.startAt ? new Date(offer.startAt).toISOString() : null,
    endAt: offer.endAt ? new Date(offer.endAt).toISOString() : null,
    startTime: offer.startTime ?? null,
    endTime: offer.endTime ?? null,
    isActive: offer.isActive ?? true,
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt,
  };
}

function serializeBarber(barber: any) {
  return {
    id: barber.id,
    salonId: barber.salonId,
    name: barber.name,
    specialty: barber.specialty ?? null,
    isActive: barber.isActive ?? true,
    createdAt: barber.createdAt,
    updatedAt: barber.updatedAt,
  };
}

function serializeReview(review: any) {
  return {
    id: review.id,
    salonId: review.salonId,
    userId: review.userId,
    rating: Number(review.rating ?? 0),
    comment: review.comment ?? null,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt ?? null,
    name: review.user?.fullName ?? "Customer",
  };
}

function serializeSalon(salon: any, options: { adminVipIds?: Set<string>; autoVipIds?: Set<string> } = {}) {
  const publicState = buildPublicSalonState(salon, options);
  return {
    ...salon,
    ...publicState,
    rating: Number(salon?.rating ?? 0),
    reviewCount: Number(salon?.reviewCount ?? 0),
    isVip: publicState.isVip,
    vip: publicState.isVip,
    barbers: Array.isArray(salon?.barbers) ? salon.barbers.map(serializeBarber) : [],
    offers: Array.isArray(salon?.offers) ? salon.offers.map(serializeOffer) : [],
    services: Array.isArray(salon?.services) ? salon.services.map(serializeService) : [],
    reviews: Array.isArray(salon?.reviews) ? salon.reviews.map(serializeReview) : [],
    media: Array.isArray(salon?.media) ? salon.media.map(serializeSalonMedia) : [],
  };
}

function decorateSalonList(salons: any[]) {
  const adminVipIds = new Set(getManualVipSalonIds(salons));
  const autoVipIds = new Set(getAutoVipSalonIds(salons));
  return salons.map((salon) => serializeSalon(salon, { adminVipIds, autoVipIds }));
}

function withStalePrismaTypes<T>(value: T) {
  return value as any;
}

async function assertAdminVipCapacity(db: any, options: { ignoreSalonId?: string | null } = {}) {
  const salons = await db.salon.findMany({
    where: options.ignoreSalonId
      ? { adminVip: true, NOT: { id: options.ignoreSalonId } }
      : { adminVip: true },
    select: { id: true, name: true, adminVip: true, isActive: true, createdAt: true, updatedAt: true },
  });
  const activeManualVipIds = getManualVipSalonIds(salons);
  if (activeManualVipIds.length >= MAX_ADMIN_VIP_SLOTS) {
    throw Object.assign(new Error(`Only ${MAX_ADMIN_VIP_SLOTS} admin VIP salons can be selected at the same time.`), { statusCode: 409 });
  }
}

async function refreshSalonRatingAggregate(db: any, salonId: string) {
  const aggregate = await db.review.aggregate({
    where: { salonId },
    _avg: { rating: true },
    _count: { rating: true },
  });
  const rating = Number(aggregate?._avg?.rating ?? 0);
  const reviewCount = Number(aggregate?._count?.rating ?? 0);
  await db.salon.update({
    where: { id: salonId },
    data: {
      rating: reviewCount > 0 ? Number(rating.toFixed(2)) : 0,
      reviewCount,
    },
  });
}

export async function salonRoutes(app: any) {
  app.post("/api/v1/salons/:id/purge-clearance/:clearanceId/revalidate", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
      if (!z.object({}).strict().safeParse(request.body ?? {}).success) {
        return reply.code(400).send({ error: "Invalid payload" });
      }
      const result = await prisma.$transaction(
        tx => revalidateSalonPurgeClearance(tx, request.params.id, request.params.clearanceId, user.id),
        { isolationLevel: "Serializable" },
      );
      return reply.code(result.status).send(result);
    } catch (error) {
      if (reply.sent) return reply;
      if ((error as any)?.code === "P2034") return reply.code(409).send({ error: "Concurrent lifecycle change; retry the request" });
      throw error;
    }
  });
  app.post("/api/v1/salons/:id/retention-holds", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
      const parsed = salonEnforcementSchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });

      const hold = await prisma.$transaction(async tx => {
        const salon = await tx.salon.findUnique({ where: { id: request.params.id }, select: { id: true } });
        if (!salon) return null;
        const createdAt = new Date();
        const created = await tx.salonRetentionHold.create({
          data: { salonId: salon.id, reason: parsed.data.reason, actorUserId: user.id, createdAt },
        });
        await tx.salonPurgeClearance.updateMany({
          where: { salonId: salon.id, revokedAt: null },
          data: { revokedAt: createdAt, revokedByUserId: user.id, revocationReason: "Retention hold created" },
        });
        return created;
      }, { isolationLevel: "Serializable" });
      if (!hold) return reply.code(404).send({ error: "Salon not found" });
      return reply.code(201).send({ hold });
    } catch (error) {
      if (reply.sent) return reply;
      if ((error as any)?.code === "P2034") return reply.code(409).send({ error: "Concurrent lifecycle change; retry the request" });
      throw error;
    }
  });

  app.post("/api/v1/salons/:id/retention-holds/:holdId/release", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
      const parsed = salonEnforcementSchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      const hold = await prisma.$transaction(async tx => {
        const existing = await tx.salonRetentionHold.findUnique({ where: { id: request.params.holdId } });
        if (!existing || existing.salonId !== request.params.id) return null;
        // Repeated release preserves the original actor, time and reason.
        if (existing.releasedAt !== null) return existing;
        return tx.salonRetentionHold.update({
          where: { id: existing.id },
          data: { releasedAt: new Date(), releasedByUserId: user.id, releaseReason: parsed.data.reason },
        });
      }, { isolationLevel: "Serializable" });
      if (!hold) return reply.code(404).send({ error: "Retention hold not found" });
      return { hold };
    } catch (error) {
      if (reply.sent) return reply;
      if ((error as any)?.code === "P2034") return reply.code(409).send({ error: "Concurrent lifecycle change; retry the request" });
      throw error;
    }
  });

  app.post("/api/v1/salons/:id/purge-clearance", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
      if (!z.object({}).strict().safeParse(request.body ?? {}).success) {
        return reply.code(400).send({ error: "Invalid payload" });
      }
      const result = await prisma.$transaction(async tx => {
        const salon = await tx.salon.findUnique({ where: { id: request.params.id }, select: { id: true } });
        if (!salon) return { status: 404, error: "Salon not found" } as const;
        const archive = await tx.salonArchive.findFirst({
          where: { salonId: salon.id },
          orderBy: [{ finalizedAt: "desc" }, { archiveId: "desc" }],
        });
        if (!archive) return { status: 409, error: "Finalized archive required" } as const;
        if (!hasCurrentSalonArchiveCoverage(archive)) {
          return { status: 409, error: "Current archive contract with complete coverage required" } as const;
        }
        const holds = await tx.salonRetentionHold.count({ where: { salonId: salon.id, releasedAt: null } });
        if (holds > 0) return { status: 409, error: "Active retention hold blocks clearance" } as const;
        const clearance = await tx.salonPurgeClearance.create({
          data: {
            salonId: salon.id,
            archiveId: archive.archiveId,
            archiveVersion: archive.archiveVersion,
            payloadVersion: archive.payloadVersion,
            archiveFinalizedAt: archive.finalizedAt,
            sourceState: archive.sourceState as Prisma.InputJsonValue,
            coverage: archive.coverage as Prisma.InputJsonValue,
            actorUserId: user.id,
            issuedAt: new Date(),
          },
        });
        return { clearance } as const;
      }, { isolationLevel: "Serializable" });
      if ("error" in result) return reply.code(result.status).send({ error: result.error });
      return reply.code(201).send({ clearance: result.clearance });
    } catch (error) {
      if (reply.sent) return reply;
      if ((error as any)?.code === "P2034") return reply.code(409).send({ error: "Concurrent lifecycle change; retry the request" });
      throw error;
    }
  });
  app.delete("/api/v1/salons/:id", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      if (user.role !== "ADMIN") {
        return reply.code(403).send({ error: "Forbidden" });
      }

      if (!z.object({}).strict().safeParse(request.body ?? {}).success) {
        return reply.code(400).send({ error: "Invalid payload" });
      }

      const salonId = request.params.id as string;
      const result = await prisma.$transaction(async tx => {
        const salon = await tx.salon.findUnique({ where: { id: salonId }, select: { id: true } });
        if (!salon) return { status: 404, error: "Salon not found" } as const;
        const readiness = await evaluateSalonDeletionReadiness(tx, salonId, user.id);
        if (!readiness.ready) return {
          status: readiness.status,
          error: "error" in readiness ? readiness.error : "Deletion readiness failed",
        } as const;

        // The same Serializable snapshot supplies readiness, indirect ownership,
        // and every delete. No preflight token or client-selected clearance is used.
        const memberships = await tx.staffMembership.findMany({ where: { salonId }, select: { id: true } });
        const cards = await tx.loyaltyCard.findMany({ where: { salonId }, select: { id: true } });
        const staffMembershipId = { in: memberships.map(row => row.id) };
        const cardId = { in: cards.map(row => row.id) };

        await tx.queueEntry.deleteMany({ where: { salonId } });
        await tx.serviceVisit.deleteMany({ where: { salonId } });
        await tx.booking.deleteMany({ where: { salonId } });
        await tx.availabilitySlot.deleteMany({ where: { salonId } });
        await tx.staffPresenceLease.deleteMany({ where: { staffMembershipId } });
        await tx.staffPresence.deleteMany({ where: { staffMembershipId } });
        await tx.staffMembership.deleteMany({ where: { salonId } });
        await tx.barber.deleteMany({ where: { salonId } });
        await tx.service.deleteMany({ where: { salonId } });
        await tx.loyaltyStamp.deleteMany({ where: { cardId } });
        await tx.loyaltyCustomer.deleteMany({ where: { cardId } });
        await tx.loyaltyCard.deleteMany({ where: { salonId } });
        await tx.analyticsEvent.deleteMany({ where: { salonId } });
        await tx.offer.deleteMany({ where: { salonId } });
        await tx.review.deleteMany({ where: { salonId } });
        await tx.salonAvailabilitySubscription.deleteMany({ where: { salonId } });
        await tx.salonBoost.deleteMany({ where: { salonId } });
        await tx.salonLiveStatus.deleteMany({ where: { salonId } });
        await tx.salonMedia.deleteMany({ where: { salonId } });
        // Message rows survive via SET NULL; V8 retains their original provenance.
        // Independent history, shared Users/subscriptions and external blobs survive.
        await tx.salon.delete({ where: { id: salonId } });
        return { status: 200 } as const;
      }, { isolationLevel: "Serializable" });
      if ("error" in result) return reply.code(result.status).send({ error: result.error });
      return { deleted: true, salonId };
    } catch (error) {
      if (reply.sent) return reply;
      if ((error as any)?.code === "P2034") return reply.code(409).send({ error: "Concurrent lifecycle change; retry the request" });
      throw error;
    }
  });

  app.post("/api/v1/salons/:id/enforcement", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      if (user.role !== "ADMIN") {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const parsed = salonEnforcementSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const enforcement = await prisma.$transaction(async (tx) => {
        const salon = await tx.salon.findUnique({
          where: { id: request.params.id },
          select: { id: true, name: true, ownerId: true, isActive: true },
        });
        if (!salon) return null;

        const subscription = await tx.userSubscription.findUnique({
          where: { userId: salon.ownerId },
          select: {
            plan: true, status: true, startDate: true, renewalDate: true,
            monthlyPrice: true, providerReference: true,
          },
        });
        const snapshot = subscription ? {
          plan: subscription.plan,
          status: subscription.status,
          startDate: subscription.startDate?.toISOString() ?? null,
          renewalDate: subscription.renewalDate?.toISOString() ?? null,
          monthlyPrice: subscription.monthlyPrice?.toString() ?? null,
          providerReference: subscription.providerReference,
        } : null;

        const evidence = await tx.salonEnforcement.create({
          data: {
            salonId: salon.id,
            salonName: salon.name,
            ownerUserId: salon.ownerId,
            reason: parsed.data.reason,
            actorUserId: user.id,
            enforcedAt: new Date(),
            previousIsActive: salon.isActive,
            // Omission stores SQL NULL; this snapshot is context, not payment proof.
            ...(snapshot === null ? {} : { subscription: snapshot }),
          },
        });
        await tx.salon.update({
          where: { id: salon.id },
          data: { isActive: false },
        });
        return { ...evidence, subscription: evidence.subscription ?? null };
      }, { isolationLevel: "Serializable" });

      if (!enforcement) {
        return reply.code(404).send({ error: "Salon not found" });
      }
      return { enforcement };
    } catch (error) {
      if (reply.sent) return reply;
      throw error;
    }
  });
  app.post("/api/v1/salons/:id/archive/finalize", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      if (user.role !== "ADMIN") {
        return reply.code(403).send({ error: "Forbidden" });
      }
      if (!z.object({}).strict().safeParse(request.body ?? {}).success) {
        return reply.code(400).send({ error: "Invalid payload" });
      }

      const archive = await prisma.$transaction(async (tx) => {
        const salon = await tx.salon.findUnique({
          where: { id: request.params.id },
          select: { id: true, name: true, ownerId: true },
        });

        if (!salon) return null;

        const state = await loadSalonArchiveState(tx, salon.id);

        return tx.salonArchive.create({
          data: {
            salonId: salon.id,
            salonName: salon.name,
            ownerUserId: salon.ownerId,
            archiveVersion: state.archiveVersion,
            payloadVersion: state.payloadVersion,
            coverage: state.coverage,
            sourceState: state.sourceState,
            source: `ADMIN:${user.id}`,
            finalizedAt: new Date(),
          },
        });
      }, { isolationLevel: "Serializable" });

      if (!archive) {
        return reply.code(404).send({ error: "Salon not found" });
      }

      return reply.code(201).send({ archive });
    } catch (error) {
      if (reply.sent) return reply;
      throw error;
    }
  });
  app.get("/api/v1/salons/:salonId/intake-controls", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      requireRole(user, ["OWNER", "ADMIN"], reply);

      const salon = await prisma.salon.findUnique({
        where: { id: request.params.salonId },
        select: withStalePrismaTypes({
          id: true,
          ownerId: true,
          bookingIntakeEnabled: true,
          saloTicketIntakeEnabled: true,
          walkInIntakeEnabled: true,
        }),
      }) as any;

      if (!salon) {
        return reply.code(404).send({ error: "Salon not found" });
      }
      if (user.role !== "ADMIN" && salon.ownerId !== user.id) {
        return reply.code(403).send({ error: "Forbidden" });
      }
if (user.role === "OWNER") {
  const subscription = await prisma.userSubscription.findUnique({
    where: { userId: user.id },
    select: { plan: true, status: true },
  });

  const plan = normalizeSubscriptionPlan(subscription?.plan);
  const hasSmartEntitlement =
    subscription?.status === "ACTIVE" &&
    SUBSCRIPTION_PLAN_ORDER.indexOf(plan) >= SUBSCRIPTION_PLAN_ORDER.indexOf("SMART");

  if (!hasSmartEntitlement) {
    return reply.code(403).send({ error: "Smart Salon subscription required" });
  }
}
      return {
        intakeControls: {
          bookingIntakeEnabled: salon.bookingIntakeEnabled,
          saloTicketIntakeEnabled: salon.saloTicketIntakeEnabled,
          walkInIntakeEnabled: salon.walkInIntakeEnabled,
        },
      };
    } catch (error) {
      if (reply.sent) return reply;
      request.log.error(error);
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  app.patch("/api/v1/salons/:salonId/intake-controls", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      requireRole(user, ["OWNER", "ADMIN"], reply);

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
if (user.role === "OWNER") {
  const subscription = await prisma.userSubscription.findUnique({
    where: { userId: user.id },
    select: { plan: true, status: true },
  });

  const plan = normalizeSubscriptionPlan(subscription?.plan);
  const hasSmartEntitlement =
    subscription?.status === "ACTIVE" &&
    SUBSCRIPTION_PLAN_ORDER.indexOf(plan) >= SUBSCRIPTION_PLAN_ORDER.indexOf("SMART");

  if (!hasSmartEntitlement) {
    return reply.code(403).send({ error: "Smart Salon subscription required" });
  }
}
      const parsed = intakeControlsPatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const updated = await prisma.salon.update({
        where: { id: salon.id },
        data: withStalePrismaTypes(parsed.data),
        select: withStalePrismaTypes({
          bookingIntakeEnabled: true,
          saloTicketIntakeEnabled: true,
          walkInIntakeEnabled: true,
        }),
      }) as any;

      return {
        intakeControls: {
          bookingIntakeEnabled: updated.bookingIntakeEnabled,
          saloTicketIntakeEnabled: updated.saloTicketIntakeEnabled,
          walkInIntakeEnabled: updated.walkInIntakeEnabled,
        },
      };
    } catch (error) {
      if (reply.sent) return reply;
      request.log.error(error);
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  app.get("/api/v1/salons", async () => {
    const salons = await prisma.salon.findMany({
      where: { isActive: true },
      include: {
        liveStatus: { select: publicLiveStatusSelect },
        services: { where: { isActive: true } },
        reviews: {
          include: {
            user: { select: { fullName: true } },
          },
        },
        media: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const now = Date.now();
    return { salons: decorateSalonList(salons).map((salon) => ({
      ...salon,
      liveStatus: projectPublicLiveStatus(salon.liveStatus, now),
    })) };
  });

  app.get("/api/v1/salons/:id", async (request: any, reply: any) => {
    const salons = await prisma.salon.findMany({
      where: { isActive: true },
      include: {
        liveStatus: { select: publicLiveStatusSelect },
        barbers: true,
        offers: {
          orderBy: { createdAt: "desc" },
        },
        services: { where: { isActive: true } },
        reviews: {
          include: {
            user: { select: { fullName: true } },
          },
        },
        media: true,
      },
    });
    const salon = salons.find((entry: any) => entry.id === request.params.id);

    if (!salon) {
      return reply.code(404).send({ error: "Salon not found" });
    }

    return { salon: {
      ...decorateSalonList(salons).find((entry: any) => entry.id === request.params.id),
      liveStatus: projectPublicLiveStatus(salon.liveStatus),
    } };
  });

  app.post("/api/v1/salons/:salonId/reviews", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      requireRole(user, ["CUSTOMER"], reply);

      const parsed = reviewSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const salon = await prisma.salon.findUnique({
        where: { id: request.params.salonId },
        select: { id: true, isActive: true },
      });
      if (!salon || salon.isActive === false) {
        return reply.code(404).send({ error: "Salon not found" });
      }

      const eligibleBooking = await prisma.booking.findFirst({
        where: {
          salonId: request.params.salonId,
          userId: user.id,
          status: "COMPLETED",
        },
        select: { id: true },
      });
      if (!eligibleBooking) {
        return reply.code(403).send({ error: "A completed booking is required before submitting a review." });
      }

      const result = await prisma.$transaction(async (tx) => {
        const review = await tx.review.upsert({
          where: {
            userId_salonId: {
              userId: user.id,
              salonId: request.params.salonId,
            },
          },
          update: {
            rating: parsed.data.rating,
            comment: parsed.data.comment?.trim() || null,
          },
          create: {
            userId: user.id,
            salonId: request.params.salonId,
            rating: parsed.data.rating,
            comment: parsed.data.comment?.trim() || null,
          },
          include: {
            user: { select: { fullName: true } },
          },
        });

        await refreshSalonRatingAggregate(tx, request.params.salonId);
        const salons = await tx.salon.findMany({
          where: { isActive: true },
          include: {
            services: { where: { isActive: true } },
            reviews: {
              include: {
                user: { select: { fullName: true } },
              },
            },
            media: true,
          },
          orderBy: { createdAt: "desc" },
        });
        return {
          review,
          salon: decorateSalonList(salons).find((entry: any) => entry.id === request.params.salonId),
        };
      });

      return {
        review: serializeReview(result.review),
        salon: result.salon,
      };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.get("/api/v1/salons/:salonId/services", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const salon = await prisma.salon.findUnique({
        where: { id: request.params.salonId },
        select: { ownerId: true },
      });

      if (!salon) {
        return reply.code(404).send({ error: "Salon not found" });
      }

      if (user.role !== "ADMIN" && (user.role !== "OWNER" || salon.ownerId !== user.id)) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const services = await prisma.service.findMany({
        where: { salonId: request.params.salonId },
        orderBy: { createdAt: "asc" },
      });

      return { services: services.map(serializeService) };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.post("/api/v1/salons/:salonId/services", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const salon = await prisma.salon.findUnique({
        where: { id: request.params.salonId },
        select: { ownerId: true },
      });

      if (!salon) {
        return reply.code(404).send({ error: "Salon not found" });
      }

      if (user.role !== "ADMIN" && (user.role !== "OWNER" || salon.ownerId !== user.id)) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const parsed = serviceCreateSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const normalized = normalizeServiceInput(parsed.data);
      const service = await prisma.service.create({
        data: {
          salonId: request.params.salonId,
          name: normalized.name,
          description: normalized.description,
          price: normalized.price,
          durationMin: normalized.durationMin,
          isActive: normalized.isActive,
        },
      });

      return { service: serializeService(service) };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.patch("/api/v1/salons/:salonId/services/:serviceId", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const service = await prisma.service.findUnique({
        where: { id: request.params.serviceId },
        select: {
          salonId: true,
          name: true,
          description: true,
          price: true,
          durationMin: true,
          isActive: true,
          salon: { select: { ownerId: true } },
        },
      });

      if (!service) {
        return reply.code(404).send({ error: "Service not found" });
      }

      if (service.salonId !== request.params.salonId) {
        return reply.code(404).send({ error: "Service not found" });
      }

      if (user.role !== "ADMIN" && (user.role !== "OWNER" || service.salon.ownerId !== user.id)) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const parsed = serviceSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const merged = { ...service, ...parsed.data };
      const normalized = normalizeServiceInput(merged);
      const nextService = await prisma.service.update({
        where: { id: request.params.serviceId },
        data: {
          name: normalized.name,
          description: normalized.description,
          price: normalized.price,
          durationMin: normalized.durationMin,
          isActive: normalized.isActive,
        },
      });

      return { service: serializeService(nextService) };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.delete("/api/v1/salons/:salonId/services/:serviceId", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const service = await prisma.service.findUnique({
        where: { id: request.params.serviceId },
        select: { salonId: true, salon: { select: { ownerId: true } } },
      });

      if (!service) {
        return reply.code(404).send({ error: "Service not found" });
      }

      if (service.salonId !== request.params.salonId) {
        return reply.code(404).send({ error: "Service not found" });
      }

      if (user.role !== "ADMIN" && (user.role !== "OWNER" || service.salon.ownerId !== user.id)) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      await prisma.service.delete({ where: { id: request.params.serviceId } });
      return { deleted: true, serviceId: request.params.serviceId };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.get("/api/v1/salons/:salonId/offers", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const salon = await prisma.salon.findUnique({
        where: { id: request.params.salonId },
        select: { ownerId: true },
      });

      if (!salon) {
        return reply.code(404).send({ error: "Salon not found" });
      }

      if (user.role !== "ADMIN" && salon.ownerId !== user.id) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const offers = await prisma.offer.findMany({
        where: { salonId: request.params.salonId },
        orderBy: { createdAt: "asc" },
      });

      return { offers: offers.map(serializeOffer) };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.post("/api/v1/salons/:salonId/offers", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const salon = await prisma.salon.findUnique({
        where: { id: request.params.salonId },
        select: { ownerId: true },
      });

      if (!salon) {
        return reply.code(404).send({ error: "Salon not found" });
      }

      if (user.role !== "ADMIN" && salon.ownerId !== user.id) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const parsed = offerSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const normalized = normalizeOfferInput(parsed.data);
      const offer = await prisma.offer.create({
        data: {
          salonId: request.params.salonId,
          title: normalized.title,
          description: normalized.description,
          price: normalized.price,
          discount: normalized.discount,
          serviceName: normalized.serviceName,
          availableSlots: normalized.availableSlots,
          startAt: normalized.startAt ?? null,
          endAt: normalized.endAt ?? null,
          startTime: normalized.startTime,
          endTime: normalized.endTime,
          isActive: normalized.isActive,
        },
      });

      return { offer: serializeOffer(offer) };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.patch("/api/v1/salons/:salonId/offers/:offerId", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const offer = await prisma.offer.findUnique({
        where: { id: request.params.offerId },
        select: { salonId: true, salon: { select: { ownerId: true } } },
      });

      if (!offer) {
        return reply.code(404).send({ error: "Offer not found" });
      }

      if (user.role !== "ADMIN" && (!offer.salon || offer.salon.ownerId !== user.id)) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const parsed = offerSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const normalized = normalizeOfferInput({ ...offer, ...parsed.data });
      const nextOffer = await prisma.offer.update({
        where: { id: request.params.offerId },
        data: {
          title: normalized.title,
          description: normalized.description,
          price: normalized.price,
          discount: normalized.discount,
          serviceName: normalized.serviceName,
          availableSlots: normalized.availableSlots,
          startAt: normalized.startAt ?? null,
          endAt: normalized.endAt ?? null,
          startTime: normalized.startTime,
          endTime: normalized.endTime,
          isActive: normalized.isActive,
        },
      });

      return { offer: serializeOffer(nextOffer) };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.delete("/api/v1/salons/:salonId/offers/:offerId", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const offer = await prisma.offer.findUnique({
        where: { id: request.params.offerId },
        select: { salonId: true, salon: { select: { ownerId: true } } },
      });

      if (!offer) {
        return reply.code(404).send({ error: "Offer not found" });
      }

      if (user.role !== "ADMIN" && (!offer.salon || offer.salon.ownerId !== user.id)) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      await prisma.offer.delete({ where: { id: request.params.offerId } });
      return { deleted: true, offerId: request.params.offerId };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.patch("/api/v1/salons/:id", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const salon = await prisma.salon.findUnique({
        where: { id: request.params.id },
        select: withStalePrismaTypes({ ownerId: true, id: true, adminVip: true, classification: true }),
      }) as { ownerId: string; id: string; adminVip?: boolean | null; classification?: string | null } | null;

      if (!salon) {
        return reply.code(404).send({ error: "Salon not found" });
      }

      if (user.role !== "ADMIN" && salon.ownerId !== user.id) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const requestedOwnerPassword = request.body?.ownerPassword;
      if (requestedOwnerPassword && user.role !== "ADMIN") {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const parsed = salonPatchSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const payload = parsed.data;
      if (payload.isActive !== undefined && user.role !== "ADMIN") {
        return reply.code(403).send({ error: "Forbidden" });
      }
      const ownerPassword = payload.ownerPassword?.trim() || "";
      const requestedClassification = normalizeSalonClassification(payload.classification ?? salon.classification);
      const requestedAdminVip = user.role === "ADMIN"
        ? Boolean(payload.adminVip ?? payload.isVip ?? salon.adminVip)
        : Boolean(salon.adminVip);
      if (user.role === "ADMIN" && requestedAdminVip && !getManualVipFlag(salon)) {
        await assertAdminVipCapacity(prisma, { ignoreSalonId: request.params.id });
      }
      const nextSalon = await prisma.$transaction(async (tx) => {
        if (ownerPassword) {
          const attachedOwner = await tx.user.findUnique({
            where: { id: salon.ownerId },
            select: { id: true, role: true, status: true },
          });

          if (!attachedOwner
            || String(attachedOwner.role || "").toUpperCase() !== "OWNER"
            || String(attachedOwner.status || "").toUpperCase() !== "ACTIVE") {
            throw Object.assign(new Error("Salon owner is not an active OWNER"), { statusCode: 409 });
          }

          await tx.user.update({
            where: { id: salon.ownerId },
            data: { passwordHash: await hashPassword(ownerPassword) },
          });
        }

        await tx.salon.update({
          where: { id: request.params.id },
          data: withStalePrismaTypes({
            name: payload.name ?? undefined,
            city: payload.city ?? undefined,
            address: payload.address ?? undefined,
            phone: payload.phone ?? undefined,
            email: payload.email ?? undefined,
            website: payload.website ?? undefined,
            description: payload.description ?? undefined,
            isActive: payload.isActive,
            isVip: requestedAdminVip,
            adminVip: requestedAdminVip,
            classification: requestedClassification,
            isWomenOnly: payload.isWomenOnly ?? undefined,
            openingTime: payload.openingTime ?? undefined,
            closingTime: payload.closingTime ?? undefined,
            workingDays: payload.workingDays,
            timeZone: payload.timeZone,
          }),
        });

        if (Object.prototype.hasOwnProperty.call(payload, "imageUrl")) {
          await syncSalonPrimaryImage(tx, request.params.id, payload.imageUrl);
        }

        return tx.salon.findUnique({
          where: { id: request.params.id },
          include: {
            services: true,
            reviews: {
              include: {
                user: { select: { fullName: true } },
              },
            },
            media: true,
          },
        });
      });

      return { salon: serializeSalon(nextSalon) };
    } catch (error) {
      if ((error as any)?.statusCode === 409) {
        return reply.code(409).send({ error: (error as Error).message });
      }
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.post("/api/v1/salons", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      requireRole(user, ["OWNER", "ADMIN"], reply);

      const parsed = salonSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const payload = parsed.data;
      const requestedClassification = user.role === "ADMIN"
        ? normalizeSalonClassification(payload.classification)
        : "REGULAR";
      const requestedAdminVip = user.role === "ADMIN" ? Boolean(payload.adminVip ?? payload.isVip) : false;
      if (requestedAdminVip) {
        await assertAdminVipCapacity(prisma);
      }
      const slug = payload.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64);

      const existing = await prisma.salon.findUnique({ where: { slug } });
      if (existing) {
        return reply.code(409).send({ error: "Salon slug already exists" });
      }

      const salon = await prisma.$transaction(async (tx) => {
        const createdSalon = await tx.salon.create({
          data: withStalePrismaTypes({
            ownerId: user.id,
            name: payload.name,
            slug,
            city: payload.city,
            address: payload.address,
            phone: payload.phone,
            email: payload.email ?? null,
            website: payload.website ?? null,
            description: payload.description ?? null,
            isVip: requestedAdminVip,
            adminVip: requestedAdminVip,
            classification: requestedClassification,
            isWomenOnly: payload.isWomenOnly ?? false,
            openingTime: payload.openingTime ?? null,
            closingTime: payload.closingTime ?? null,
            workingDays: payload.workingDays ?? [],
            timeZone: payload.timeZone ?? null,
          }),
        });

        await syncSalonPrimaryImage(tx, createdSalon.id, payload.imageUrl);

        return tx.salon.findUnique({
          where: { id: createdSalon.id },
          include: {
            services: true,
            reviews: {
              include: {
                user: { select: { fullName: true } },
              },
            },
            media: true,
          },
        });
      });

      return { salon: serializeSalon(salon) };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
}
