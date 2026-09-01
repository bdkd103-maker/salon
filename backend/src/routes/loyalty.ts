import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { requireRole, requireUserFromAuthHeader } from "../lib/auth.js";
import { buildStampTransactionId, getLoyaltyProgress } from "../lib/loyalty.js";

const loyaltyCardSchema = z.object({
  salonId: z.string().trim().min(1),
  requiredStamps: z.number().int().min(1).max(100).optional(),
  rewardTitle: z.string().trim().min(1).max(120).optional(),
  rewardText: z.string().trim().min(1).max(240).optional(),
  description: z.string().trim().max(500).optional(),
  isActive: z.boolean().optional(),
  rewardType: z.enum(["FREE_SERVICE", "PERCENTAGE_DISCOUNT", "FIXED_DISCOUNT"]).optional(),
});

const loyaltyStampSchema = z.object({
  cardId: z.string().trim().min(1),
  customerId: z.string().trim().min(1),
  transactionId: z.string().trim().min(1).optional(),
  verificationToken: z.string().trim().min(1).optional(),
  barberId: z.string().trim().min(1).optional(),
});

export async function loyaltyRoutes(app: any) {
  app.get("/api/v1/loyalty/cards/:salonId", async (request: any, reply: any) => {
    const { salonId } = request.params;

    const card = await prisma.loyaltyCard.findFirst({
      where: { salonId },
      orderBy: { createdAt: "desc" },
      include: {
        customers: {
          orderBy: { currentStamps: "desc" },
          include: {
            customer: {
              select: { id: true, fullName: true, email: true, phone: true },
            },
          },
        },
        stamps: {
          select: { id: true, customerId: true, stampAt: true, isValid: true },
          orderBy: { stampAt: "desc" },
        },
      },
    });

    if (!card) {
      return { card: null };
    }

    const formattedCustomers = card.customers.map((customer) => ({
      id: customer.id,
      customerId: customer.customerId,
      currentStamps: customer.currentStamps,
      totalVisits: customer.totalVisits,
      lastStampedAt: customer.lastStampedAt,
      rewardRedeemedAt: customer.rewardRedeemedAt,
      customer: customer.customer,
    }));

    return {
      card: {
        id: card.id,
        salonId: card.salonId,
        requiredStamps: card.requiredStamps,
        rewardTitle: card.rewardTitle,
        rewardText: card.rewardText,
        description: card.description,
        isActive: card.isActive,
        rewardType: card.rewardType,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
        customers: formattedCustomers,
        totalStamps: card.stamps.filter((stamp) => stamp.isValid !== false).length,
        rewardsCompleted: formattedCustomers.filter((customer) => Number(customer.currentStamps ?? 0) >= Number(card.requiredStamps ?? 0)).length,
      },
    };
  });

  app.get("/api/v1/loyalty/customer/:cardId", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const card = await prisma.loyaltyCard.findUnique({
        where: { id: request.params.cardId },
        include: { customers: true },
      });

      if (!card) {
        return reply.code(404).send({ error: "Loyalty card not found" });
      }

      const customerRecord = await prisma.loyaltyCustomer.findUnique({
        where: { cardId_customerId: { cardId: card.id, customerId: user.id } },
      });

      const progress = getLoyaltyProgress(customerRecord?.currentStamps ?? 0, card.requiredStamps);

      return {
        card: {
          id: card.id,
          salonId: card.salonId,
          requiredStamps: card.requiredStamps,
          rewardTitle: card.rewardTitle,
          rewardText: card.rewardText,
          isActive: card.isActive,
          progress,
        },
      };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.post("/api/v1/loyalty/cards", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      requireRole(user, ["OWNER", "ADMIN"], reply);

      const parsed = loyaltyCardSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const salon = await prisma.salon.findFirst({
        where: {
          id: parsed.data.salonId,
          ownerId: user.role === "OWNER" ? user.id : undefined,
        },
      });

      if (!salon && user.role !== "ADMIN") {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const existing = await prisma.loyaltyCard.findFirst({
        where: { salonId: parsed.data.salonId, isActive: true },
      });

      if (existing) {
        return reply.code(409).send({ error: "Loyalty card already exists for this salon" });
      }

      const card = await prisma.loyaltyCard.create({
        data: {
          salonId: parsed.data.salonId,
          requiredStamps: parsed.data.requiredStamps ?? 8,
          rewardTitle: parsed.data.rewardTitle ?? "Free haircut",
          rewardText: parsed.data.rewardText ?? "Free haircut",
          description: parsed.data.description ?? null,
          isActive: parsed.data.isActive ?? true,
          rewardType: parsed.data.rewardType ?? "FREE_SERVICE",
        },
      });

      return { card };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.patch("/api/v1/loyalty/cards/:id", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      requireRole(user, ["OWNER", "ADMIN"], reply);

      const card = await prisma.loyaltyCard.findUnique({ where: { id: request.params.id } });
      if (!card) {
        return reply.code(404).send({ error: "Loyalty card not found" });
      }

      if (user.role !== "ADMIN") {
        const salon = await prisma.salon.findUnique({ where: { id: card.salonId }, select: { ownerId: true } });
        if (!salon || salon.ownerId !== user.id) {
          return reply.code(403).send({ error: "Forbidden" });
        }
      }

      const payload = loyaltyCardSchema.partial().safeParse(request.body ?? {});
      if (!payload.success) {
        return reply.code(400).send({ error: "Invalid payload", details: payload.error.flatten() });
      }

      const updated = await prisma.loyaltyCard.update({
        where: { id: card.id },
        data: {
          requiredStamps: payload.data.requiredStamps ?? card.requiredStamps,
          rewardTitle: payload.data.rewardTitle ?? card.rewardTitle,
          rewardText: payload.data.rewardText ?? card.rewardText,
          description: payload.data.description ?? card.description,
          isActive: payload.data.isActive ?? card.isActive,
          rewardType: payload.data.rewardType ?? card.rewardType,
          updatedAt: new Date(),
        },
      });

      return { card: updated };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.post("/api/v1/loyalty/stamps", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      requireRole(user, ["OWNER", "ADMIN", "STAFF"], reply);

      const parsed = loyaltyStampSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { cardId, customerId, transactionId, verificationToken, barberId } = parsed.data;
      const card = await prisma.loyaltyCard.findUnique({ where: { id: cardId } });
      if (!card || !card.isActive) {
        return reply.code(404).send({ error: "Loyalty card is not active" });
      }

      if (customerId === user.id) {
        return reply.code(403).send({ error: "Customers cannot add their own stamp" });
      }

      const existingStamp = await prisma.loyaltyStamp.findFirst({
        where: {
          cardId,
          customerId,
          OR: [
            { transactionId: transactionId ?? "" },
            { verificationToken: verificationToken ?? "" },
          ],
        },
      });

      if (existingStamp) {
        return reply.code(409).send({ error: "Duplicate stamp is not allowed" });
      }

      const stampId = transactionId ?? buildStampTransactionId();
      const stamp = await prisma.loyaltyStamp.create({
        data: {
          cardId,
          customerId,
          barberId: barberId ?? null,
          transactionId: stampId,
          verificationToken: verificationToken ?? null,
          stampAt: new Date(),
          isValid: true,
        },
      });

      let customerRecord = await prisma.loyaltyCustomer.findUnique({
        where: { cardId_customerId: { cardId, customerId } },
      });

      if (!customerRecord) {
        customerRecord = await prisma.loyaltyCustomer.create({
          data: { cardId, customerId, currentStamps: 1, totalVisits: 1, lastStampedAt: new Date() },
        });
      } else {
        customerRecord = await prisma.loyaltyCustomer.update({
          where: { id: customerRecord.id },
          data: {
            currentStamps: customerRecord.currentStamps + 1,
            totalVisits: customerRecord.totalVisits + 1,
            lastStampedAt: new Date(),
          },
        });
      }

      return {
        stamp,
        customer: customerRecord,
        progress: getLoyaltyProgress(customerRecord.currentStamps, card.requiredStamps),
      };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
}
