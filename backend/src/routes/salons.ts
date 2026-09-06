import { z } from "zod";

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

const salonClassificationSchema = z.enum(["REGULAR", "PREMIUM"]).optional();

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
  ownerPassword: z.string().trim().min(8).max(128).optional().or(z.literal("")),
});

const serviceSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(240).optional().or(z.literal("")),
  price: z.union([z.number(), z.string()]).optional(),
  durationMin: z.union([z.number(), z.string()]).optional(),
  isActive: z.boolean().optional(),
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
  app.get("/api/v1/salons", async () => {
    const salons = await prisma.salon.findMany({
      where: { isActive: true },
      include: {
        services: true,
        reviews: {
          include: {
            user: { select: { fullName: true } },
          },
        },
        media: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return { salons: decorateSalonList(salons) };
  });

  app.get("/api/v1/salons/:id", async (request: any, reply: any) => {
    const salons = await prisma.salon.findMany({
      where: { isActive: true },
      include: {
        barbers: true,
        offers: {
          orderBy: { createdAt: "desc" },
        },
        services: true,
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

    return { salon: decorateSalonList(salons).find((entry: any) => entry.id === request.params.id) };
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
            services: true,
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

      if (user.role !== "ADMIN" && salon.ownerId !== user.id) {
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

      if (user.role !== "ADMIN" && salon.ownerId !== user.id) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const parsed = serviceSchema.safeParse(request.body ?? {});
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
        select: { salonId: true, salon: { select: { ownerId: true } } },
      });

      if (!service) {
        return reply.code(404).send({ error: "Service not found" });
      }

      if (user.role !== "ADMIN" && service.salon.ownerId !== user.id) {
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

      if (user.role !== "ADMIN" && service.salon.ownerId !== user.id) {
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
