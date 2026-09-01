import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { requireRole, requireUserFromAuthHeader } from "../lib/auth.js";
import { normalizeOfferInput } from "../lib/offer.js";
import { normalizeServiceInput } from "../lib/service.js";

const salonSchema = z.object({
  name: z.string().min(2),
  city: z.string().min(2),
  address: z.string().min(5),
  phone: z.string().min(7),
  email: z.string().email().optional(),
  website: z.string().url().optional(),
  description: z.string().optional(),
  isVip: z.boolean().optional(),
  isWomenOnly: z.boolean().optional(),
  openingTime: z.string().optional(),
  closingTime: z.string().optional(),
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

export async function salonRoutes(app: any) {
  app.get("/api/v1/salons", async () => {
    const salons = await prisma.salon.findMany({
      where: { isActive: true },
      include: {
        services: true,
        reviews: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return { salons };
  });

  app.get("/api/v1/salons/:id", async (request: any, reply: any) => {
    const salon = await prisma.salon.findUnique({
      where: { id: request.params.id },
      include: {
        services: true,
        reviews: true,
      },
    });

    if (!salon) {
      return reply.code(404).send({ error: "Salon not found" });
    }

    return { salon: { ...salon, services: salon.services.map(serializeService) } };
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
        select: { ownerId: true, id: true },
      });

      if (!salon) {
        return reply.code(404).send({ error: "Salon not found" });
      }

      if (user.role !== "ADMIN" && salon.ownerId !== user.id) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const parsed = salonSchema.partial().safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const payload = parsed.data;
      const nextSalon = await prisma.salon.update({
        where: { id: request.params.id },
        data: {
          name: payload.name ?? undefined,
          city: payload.city ?? undefined,
          address: payload.address ?? undefined,
          phone: payload.phone ?? undefined,
          email: payload.email ?? undefined,
          website: payload.website ?? undefined,
          description: payload.description ?? undefined,
          isVip: payload.isVip ?? undefined,
          isWomenOnly: payload.isWomenOnly ?? undefined,
          openingTime: payload.openingTime ?? undefined,
          closingTime: payload.closingTime ?? undefined,
        },
        include: { services: true, reviews: true },
      });

      return { salon: { ...nextSalon, services: nextSalon.services.map(serializeService) } };
    } catch {
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

      const salon = await prisma.salon.create({
        data: {
          ownerId: user.id,
          name: payload.name,
          slug,
          city: payload.city,
          address: payload.address,
          phone: payload.phone,
          email: payload.email ?? null,
          website: payload.website ?? null,
          description: payload.description ?? null,
          isVip: payload.isVip ?? false,
          isWomenOnly: payload.isWomenOnly ?? false,
          openingTime: payload.openingTime ?? null,
          closingTime: payload.closingTime ?? null,
        },
      });

      return { salon };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
}
