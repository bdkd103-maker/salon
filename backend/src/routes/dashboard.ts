import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { requireRole, requireUserFromAuthHeader, sanitizeUser } from "../lib/auth.js";
import { summarizeAdminDashboard } from "../lib/admin-dashboard.js";
import { serializeSalonMedia } from "../lib/salon-media.js";
import { buildPublicSalonState, getAutoVipSalonIds, getManualVipSalonIds } from "../lib/salon-vip.js";
import { getSubscriptionMeta, normalizeSubscriptionPlan } from "../lib/subscription-plan.js";

const profileUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().min(7).max(20).optional().or(z.literal("")),
  email: z.string().trim().email().optional(),
  avatarUrl: z.string().trim().url().optional().or(z.literal("")),
});

const messageSchema = z.object({
  salonId: z.string().trim().min(1).optional(),
  recipientId: z.string().trim().min(1).optional(),
  subject: z.string().trim().max(120).optional(),
  body: z.string().trim().min(1).max(4000),
});

const notificationReadSchema = z.object({
  notificationIds: z.array(z.string().trim().min(1)).optional(),
  readAll: z.boolean().optional(),
});

const availabilityWatchSchema = z.object({
  status: z.enum(["ACTIVE", "CANCELLED"]).optional(),
});

const subscriptionUpdateSchema = z.object({
  plan: z.enum(["FREE", "PRO", "PREMIUM"]).optional(),
  status: z.enum(["ACTIVE", "TRIAL", "PAST_DUE", "CANCELLED", "EXPIRED"]).optional(),
});

function serializeOwnerSalon(salon: any) {
  const publicState = salon?.vipSource
    ? {
        baseClassification: salon.baseClassification ?? salon.classification ?? "REGULAR",
        classification: salon.classification ?? "REGULAR",
        vipSource: salon.vipSource,
        adminVip: Boolean(salon.adminVip),
        isVip: Boolean(salon.isVip ?? salon.vip),
      }
    : buildPublicSalonState(salon);
  return {
    ...salon,
    ...publicState,
    isVip: publicState.isVip,
    vip: publicState.isVip,
    media: Array.isArray(salon?.media) ? salon.media.map(serializeSalonMedia) : [],
  };
}

function decorateSalons(salons: any[]) {
  const adminVipIds = new Set(getManualVipSalonIds(salons));
  const autoVipIds = new Set(getAutoVipSalonIds(salons));
  return salons.map((salon) => serializeOwnerSalon({ ...salon, ...buildPublicSalonState(salon, { adminVipIds, autoVipIds }) }));
}

function withStalePrismaTypes<T>(value: T) {
  return value as any;
}

export async function dashboardRoutes(app: any) {
  app.get("/api/v1/profile/me", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      return { user: sanitizeUser(user) };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.put("/api/v1/profile/me", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const parsed = profileUpdateSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const updates = parsed.data;
      const nextEmail = updates.email ? updates.email.trim().toLowerCase() : user.email;
      const nextPhone = updates.phone && updates.phone.trim() ? updates.phone.trim() : user.phone;
      const nextFullName = updates.fullName ? updates.fullName.trim() : user.fullName;

      if (updates.email && updates.email !== user.email) {
        const existing = await prisma.user.findUnique({ where: { email: nextEmail } });
        if (existing && existing.id !== user.id) {
          return reply.code(409).send({ error: "User already exists" });
        }
      }

      const nextUser = await prisma.user.update({
        where: { id: user.id },
        data: {
          fullName: nextFullName,
          phone: nextPhone ?? null,
          email: nextEmail,
          avatarUrl: updates.avatarUrl && updates.avatarUrl.trim() ? updates.avatarUrl.trim() : user.avatarUrl,
        },
      });

      return { user: sanitizeUser(nextUser) };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.get("/api/v1/owner/dashboard", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      requireRole(user, ["OWNER", "ADMIN"], reply);

      const salons = await prisma.salon.findMany({
        where: user.role === "OWNER" ? { ownerId: user.id } : undefined,
        include: {
          bookings: true,
          services: true,
          barbers: true,
          reviews: {
            include: {
              user: { select: { fullName: true } },
            },
          },
          media: true,
        },
        orderBy: { createdAt: "desc" },
      });

      const totalBookings = salons.reduce((sum, salon) => sum + salon.bookings.length, 0);
      const pendingBookings = salons.reduce((sum, salon) => sum + salon.bookings.filter((b) => b.status === "PENDING").length, 0);
      const activeSalons = salons.filter((salon) => salon.isActive).length;

      return {
        user: sanitizeUser(user),
        stats: {
          totalSalons: salons.length,
          activeSalons,
          totalBookings,
          pendingBookings,
        },
        salons: decorateSalons(salons),
      };
    } catch (error) {
      if (reply.sent) {
        return reply;
      }

      throw error;
    }
  });

  app.get("/api/v1/admin/dashboard", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      requireRole(user, ["ADMIN"], reply);

      const [
        users,
        salons,
        barbers,
        availabilitySlots,
        bookings,
        reviews,
        offers,
        analyticsEvents,
        notifications,
        subscriptions,
        boosts,
        loyaltyCards,
      ] = await Promise.all([
        prisma.user.findMany({
          select: { id: true, role: true, status: true, deletedAt: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.salon.findMany({
          select: withStalePrismaTypes({ id: true, isActive: true, isVip: true, adminVip: true, classification: true, status: true, createdAt: true }),
          orderBy: { createdAt: "desc" },
        }),
        prisma.barber.findMany({
          select: { id: true, isActive: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.availabilitySlot.findMany({
          select: { id: true, status: true },
          orderBy: { startAt: "asc" },
        }),
        prisma.booking.findMany({
          select: { id: true, status: true, startAt: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.review.findMany({
          select: { id: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.offer.findMany({
          select: {
            id: true,
            salonId: true,
            title: true,
            description: true,
            price: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
            salon: {
              select: { id: true, name: true },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.analyticsEvent.findMany({
          select: { eventType: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.notification.findMany({
          select: { id: true, isRead: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.userSubscription.findMany({
          select: {
            id: true,
            userId: true,
            plan: true,
            status: true,
            monthlyPrice: true,
            startDate: true,
            renewalDate: true,
            createdAt: true,
            updatedAt: true,
            user: {
              select: { id: true, fullName: true, email: true },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.salonBoost.findMany({
          select: {
            id: true,
            salonId: true,
            salon: { select: { id: true, name: true } },
            status: true,
            durationDays: true,
            startsAt: true,
            endsAt: true,
            amountCents: true,
            currency: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.loyaltyCard.findMany({
          select: {
            id: true,
            salonId: true,
            isActive: true,
            requiredStamps: true,
            rewardTitle: true,
            rewardText: true,
            salon: { select: { id: true, name: true, ownerId: true } },
            customers: {
              select: {
                id: true,
                customerId: true,
                currentStamps: true,
                lastStampedAt: true,
                customer: { select: { id: true, fullName: true, email: true } },
              },
              orderBy: { lastStampedAt: "desc" },
            },
            stamps: {
              select: { id: true, customerId: true, stampAt: true, isValid: true },
              orderBy: { stampAt: "desc" },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
      ]);

      const normalizedSubscriptionsForSummary = subscriptions.map((subscription) => ({
        id: subscription.id,
        userId: subscription.userId,
        user: subscription.user,
        plan: subscription.plan,
        status: subscription.status,
        monthlyPrice: subscription.monthlyPrice ? Number(subscription.monthlyPrice.toString()) : 0,
        startDate: subscription.startDate,
        renewalDate: subscription.renewalDate,
        createdAt: subscription.createdAt,
        updatedAt: subscription.updatedAt,
      }));

      const loyaltySummary = summarizeAdminDashboard({
        users,
        salons,
        barbers,
        availabilitySlots,
        bookings,
        reviews,
        offers,
        analyticsEvents,
        notifications,
        subscriptions: normalizedSubscriptionsForSummary,
        boosts,
        loyaltyCards,
      });

      const totalLoyaltyStamps = loyaltyCards.reduce((sum, card) => sum + (Array.isArray(card?.stamps) ? card.stamps.filter((stamp) => stamp?.isValid !== false).length : 0), 0);
      const completedRewards = loyaltyCards.reduce((sum, card) => {
        const threshold = Number(card?.requiredStamps ?? 0) || 0;
        if (!threshold || !Array.isArray(card?.customers)) return sum;
        return sum + card.customers.filter((customer) => Number(customer?.currentStamps ?? 0) >= threshold).length;
      }, 0);
      const dayMs = 1000 * 60 * 60 * 24;
      const weekMs = dayMs * 7;
      const monthMs = dayMs * 30;
      const now = Date.now();
      const loyaltyUsageDaily = loyaltyCards.reduce((sum, card) => sum + (Array.isArray(card?.stamps) ? card.stamps.filter((stamp) => {
        const stampDate = stamp?.stampAt ? new Date(stamp.stampAt) : null;
        return stampDate && !Number.isNaN(stampDate.getTime()) && now - stampDate.getTime() <= dayMs;
      }).length : 0), 0);
      const loyaltyUsageWeekly = loyaltyCards.reduce((sum, card) => sum + (Array.isArray(card?.stamps) ? card.stamps.filter((stamp) => {
        const stampDate = stamp?.stampAt ? new Date(stamp.stampAt) : null;
        return stampDate && !Number.isNaN(stampDate.getTime()) && now - stampDate.getTime() <= weekMs;
      }).length : 0), 0);
      const loyaltyUsageMonthly = loyaltyCards.reduce((sum, card) => sum + (Array.isArray(card?.stamps) ? card.stamps.filter((stamp) => {
        const stampDate = stamp?.stampAt ? new Date(stamp.stampAt) : null;
        return stampDate && !Number.isNaN(stampDate.getTime()) && now - stampDate.getTime() <= monthMs;
      }).length : 0), 0);

      const normalizedSubscriptions = subscriptions.map((subscription) => ({
        id: subscription.id,
        userId: subscription.userId,
        user: subscription.user,
        plan: subscription.plan,
        status: subscription.status,
        monthlyPrice: subscription.monthlyPrice ? Number(subscription.monthlyPrice.toString()) : 0,
        startDate: subscription.startDate,
        renewalDate: subscription.renewalDate,
        createdAt: subscription.createdAt,
        updatedAt: subscription.updatedAt,
      }));

      return {
        user: sanitizeUser(user),
        summary: loyaltySummary,
        subscriptions: normalizedSubscriptions,
        offers: offers.map((offer) => ({
          id: offer.id,
          title: offer.title,
          description: offer.description,
          price: offer.price,
          isActive: offer.isActive,
          createdAt: offer.createdAt,
          updatedAt: offer.updatedAt,
          salonId: offer.salonId,
          salon: offer.salon,
        })),
        boosts: boosts.map((boost) => ({
          id: boost.id,
          salonId: boost.salonId,
          salon: boost.salon,
          status: boost.status,
          durationDays: boost.durationDays,
          startsAt: boost.startsAt,
          endsAt: boost.endsAt,
          amountCents: boost.amountCents,
          currency: boost.currency,
          createdAt: boost.createdAt,
          updatedAt: boost.updatedAt,
        })),
        flashDeals: [],
        loyalty: {
          cards: loyaltyCards.map((card) => ({
            id: card.id,
            salonId: card.salonId,
            salon: card.salon,
            isActive: card.isActive,
            requiredStamps: card.requiredStamps,
            rewardTitle: card.rewardTitle,
            rewardText: card.rewardText,
            customers: Array.isArray(card.customers) ? card.customers.map((customer) => ({
              id: customer.id,
              customerId: customer.customerId,
              currentStamps: customer.currentStamps,
              lastStampedAt: customer.lastStampedAt,
              customer: customer.customer,
              rewardReady: Number(customer.currentStamps ?? 0) >= Number(card.requiredStamps ?? 0),
            })) : [],
            stamps: Array.isArray(card.stamps) ? card.stamps.filter((stamp) => stamp?.isValid !== false) : [],
          })),
          summary: {
            salonsUsing: new Set(loyaltyCards.filter((card) => card?.salonId).map((card) => card.salonId)).size,
            totalCards: loyaltyCards.length,
            totalStamps: totalLoyaltyStamps,
            completedRewards,
            usageDaily: loyaltyUsageDaily,
            usageWeekly: loyaltyUsageWeekly,
            usageMonthly: loyaltyUsageMonthly,
          },
        },
      };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.get("/api/v1/subscriptions/me", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      requireRole(user, ["OWNER", "ADMIN"], reply);

      const subscription = await prisma.userSubscription.findUnique({
        where: { userId: user.id },
      });

      const plan = normalizeSubscriptionPlan(subscription?.plan ?? "FREE");
      const meta = getSubscriptionMeta(plan);
      const result = {
        id: subscription?.id ?? null,
        userId: user.id,
        plan,
        status: subscription?.status ?? "ACTIVE",
        monthlyPrice: subscription?.monthlyPrice ?? meta.monthlyPrice,
        startDate: subscription?.startDate ?? new Date(),
        renewalDate: subscription?.renewalDate ?? new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
        cancellationDate: subscription?.cancellationDate ?? null,
        providerReference: subscription?.providerReference ?? null,
        notes: subscription?.notes ?? "No payment provider connected yet.",
        meta,
      };

      return { subscription: result };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.post("/api/v1/subscriptions/me", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      requireRole(user, ["OWNER", "ADMIN"], reply);

      const parsed = subscriptionUpdateSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const plan = normalizeSubscriptionPlan(parsed.data.plan ?? "FREE");
      const status = parsed.data.status ?? "ACTIVE";
      const meta = getSubscriptionMeta(plan);
      const now = new Date();
      const renewalDate = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30);

      const subscription = await prisma.userSubscription.upsert({
        where: { userId: user.id },
        update: {
          plan,
          status,
          monthlyPrice: meta.monthlyPrice,
          startDate: now,
          renewalDate,
          cancellationDate: status === "CANCELLED" ? now : null,
          notes: status === "CANCELLED" ? "Subscription cancelled by owner." : "Subscription managed without payment gateway.",
        },
        create: {
          userId: user.id,
          plan,
          status,
          monthlyPrice: meta.monthlyPrice,
          startDate: now,
          renewalDate,
          notes: "Subscription managed without payment gateway.",
        },
      });

      return {
        subscription: {
          id: subscription.id,
          userId: user.id,
          plan,
          status,
          monthlyPrice: subscription.monthlyPrice ?? meta.monthlyPrice,
          startDate: subscription.startDate ?? now,
          renewalDate: subscription.renewalDate ?? renewalDate,
          cancellationDate: subscription.cancellationDate ?? null,
          providerReference: subscription.providerReference ?? null,
          notes: subscription.notes ?? "Subscription managed without payment gateway.",
          meta,
        },
      };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.get("/api/v1/messages", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const messages = await prisma.message.findMany({
        where: {
          OR: [
            { senderId: user.id },
            { receiverId: user.id },
            { salon: { ownerId: user.id } },
          ],
        },
        include: {
          sender: true,
          receiver: true,
          salon: true,
        },
        orderBy: { createdAt: "desc" },
      });

      return { messages };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.post("/api/v1/messages", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const parsed = messageSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { salonId, recipientId, subject, body } = parsed.data;
      let receiverId: string | null = recipientId ?? null;

      if (!receiverId && salonId) {
        const salon = await prisma.salon.findUnique({ where: { id: salonId }, select: { ownerId: true } });
        if (salon) {
          receiverId = salon.ownerId;
        }
      }

      if (!receiverId && user.role === "CUSTOMER") {
        const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
        receiverId = admin?.id ?? null;
      }

      if (!receiverId) {
        return reply.code(400).send({ error: "No recipient configured for this message" });
      }

      const message = await prisma.message.create({
        data: {
          senderId: user.id,
          receiverId,
          salonId: salonId ?? null,
          subject: subject ?? "Message",
          body,
          isRead: false,
        },
      });

      return { message };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.get("/api/v1/notifications", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const notifications = await prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });

      return { notifications };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.post("/api/v1/notifications/read", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const parsed = notificationReadSchema.safeParse(request.body ?? {});

      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      if (parsed.data.readAll) {
        await prisma.notification.updateMany({
          where: { userId: user.id, isRead: false },
          data: { isRead: true },
        });
        return { ok: true };
      }

      if (parsed.data.notificationIds && parsed.data.notificationIds.length) {
        await prisma.notification.updateMany({
          where: {
            id: { in: parsed.data.notificationIds },
            userId: user.id,
          },
          data: { isRead: true },
        });
      }

      return { ok: true };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.get("/api/v1/availability-watch/me", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const subscriptions = await prisma.salonAvailabilitySubscription.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });
      return { subscriptions };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.get("/api/v1/salons/:salonId/availability-watch", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const subscription = await prisma.salonAvailabilitySubscription.findUnique({
        where: {
          userId_salonId: {
            userId: user.id,
            salonId: request.params.salonId,
          },
        },
      });

      return { subscription: subscription ?? null };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.post("/api/v1/salons/:salonId/availability-watch", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const parsed = availabilityWatchSchema.safeParse(request.body ?? {});

      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const salon = await prisma.salon.findUnique({ where: { id: request.params.salonId } });
      if (!salon) {
        return reply.code(404).send({ error: "Salon not found" });
      }

      const subscription = await prisma.salonAvailabilitySubscription.upsert({
        where: {
          userId_salonId: {
            userId: user.id,
            salonId: salon.id,
          },
        },
        update: {
          status: parsed.data.status ?? "ACTIVE",
          lastKnownAvailableChairs: 0,
        },
        create: {
          userId: user.id,
          salonId: salon.id,
          status: parsed.data.status ?? "ACTIVE",
          lastKnownAvailableChairs: 0,
        },
      });

      return { subscription };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.delete("/api/v1/salons/:salonId/availability-watch", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const subscription = await prisma.salonAvailabilitySubscription.updateMany({
        where: {
          userId: user.id,
          salonId: request.params.salonId,
        },
        data: {
          status: "CANCELLED",
          updatedAt: new Date(),
        },
      });

      return { ok: true, updated: subscription.count };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
}
