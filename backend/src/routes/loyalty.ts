import { redeemLoyalty } from "../lib/loyalty-ledger.js";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { requireRole, requireUserFromAuthHeader } from "../lib/auth.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { accessTokenVersionMatches } from "../lib/auth-version.js";
import { getLoyaltyProgress } from "../lib/loyalty.js";

const loyaltyCardSchema = z.object({
  salonId: z.string().trim().min(1),
  requiredStamps: z.number().int().min(1).max(100).optional(),
  rewardTitle: z.string().trim().min(1).max(120).optional(),
  rewardText: z.string().trim().min(1).max(240).optional(),
  description: z.string().trim().max(500).optional(),
  isActive: z.boolean().optional(),
  rewardActive: z.boolean().optional(),
  rewardType: z.enum(["FREE_SERVICE", "PERCENTAGE_DISCOUNT", "FIXED_DISCOUNT"]).optional(),
});

/** Optional authentication: returns the caller when a valid access token is present, otherwise null. */
async function resolveOptionalUser(request: any) {
  const authorization = request?.headers?.authorization;
  const headerValue = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!headerValue || !headerValue.startsWith("Bearer ")) return null;
  try {
    const payload = verifyAccessToken(headerValue.slice("Bearer ".length));
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== "ACTIVE" || !accessTokenVersionMatches(payload, user)) return null;
    return user;
  } catch {
    return null;
  }
}

export async function loyaltyRoutes(app: any) {
  app.get("/api/v1/loyalty/cards/:salonId", async (request: any, reply: any) => {
    const { salonId } = request.params;
    const caller = await resolveOptionalUser(request);
    const salon = await prisma.salon.findUnique({ where: { id: salonId }, select: { ownerId: true } });

    // The card summary is public (salon profile). The customer roster carries
    // names, emails and phone numbers and stays limited to the salon owner/admin.
    const canViewRoster =
      !!caller &&
      (caller.role === "ADMIN" || (caller.role === "OWNER" && salon?.ownerId === caller.id));

    const card = await prisma.loyaltyCard.findFirst({
      where: { salonId },
      orderBy: { createdAt: "desc" },
      include: {
        customers: canViewRoster
          ? {
              orderBy: { currentStamps: "desc" },
              include: {
                customer: {
                  select: { id: true, fullName: true },
                },
              },
            }
          : false,
        stamps: canViewRoster ? {
          select: { id: true, customerId: true, stampAt: true, isValid: true },
          orderBy: { stampAt: "desc" },
        } : false,
      },
    });

    if (!card) {
      return { card: null };
    }

    const baseCard = {
      id: card.id,
      salonId: card.salonId,
      requiredStamps: card.requiredStamps,
      rewardTitle: card.rewardTitle,
      rewardText: card.rewardText,
      description: card.description,
      isActive: card.isActive,
      rewardActive: card.rewardActive,
      earningRule: "COMPLETED_VISIT",
      rewardType: card.rewardType,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    };

    if (!canViewRoster) {
      return { card: baseCard };
    }

    const roster = (card as any).customers ?? [];
    const formattedCustomers = roster.map((customer: any) => ({
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
        ...baseCard,
        customers: formattedCustomers,
        totalStamps: card.stamps.filter((stamp) => stamp.isValid !== false).length,
        rewardsCompleted: formattedCustomers.filter((customer: any) => Number(customer.currentStamps ?? 0) >= Number(card.requiredStamps ?? 0)).length,
      },
    };
  });

  app.get("/api/v1/loyalty/customer/:cardId", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const card = await prisma.loyaltyCard.findUnique({
        where: { id: request.params.cardId },
      });

      if (!card) {
        return reply.code(404).send({ error: "Loyalty card not found" });
      }

      requireRole(user, ["CUSTOMER"], reply);
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
    } catch (error:any) {
      if (reply.sent) return reply;
      return reply.code(error.statusCode || 500).send({ error: error.statusCode ? error.message : "Loyalty operation failed" });
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

      if (!salon) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const card = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Salon" WHERE "id" = ${parsed.data.salonId} FOR UPDATE`;
      const existing = await tx.loyaltyCard.findFirst({
        where: { salonId: parsed.data.salonId },
      });

      if (existing) {
        throw Object.assign(new Error("Loyalty card already exists for this salon"), {statusCode:409});
      }

      return tx.loyaltyCard.create({
        data: {
          salonId: parsed.data.salonId,
          requiredStamps: parsed.data.requiredStamps ?? 8,
          rewardTitle: parsed.data.rewardTitle ?? "Free haircut",
          rewardText: parsed.data.rewardText ?? "Free haircut",
          description: parsed.data.description ?? null,
          isActive: parsed.data.isActive ?? true,
          rewardActive: parsed.data.rewardActive ?? true,
          rewardType: parsed.data.rewardType ?? "FREE_SERVICE",
        },
      });

      });
      return { card };
    } catch (error:any) {
      if (reply.sent) return reply;
      return reply.code(error.statusCode || 500).send({ error: error.statusCode ? error.message : "Loyalty operation failed" });
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
          rewardActive: payload.data.rewardActive ?? card.rewardActive,
          rewardType: payload.data.rewardType ?? card.rewardType,
          updatedAt: new Date(),
        },
      });

      return { card: updated };
    } catch (error:any) {
      if (reply.sent) return reply;
      return reply.code(error.statusCode || 500).send({ error: error.statusCode ? error.message : "Loyalty operation failed" });
    }
  });

  app.post("/api/v1/loyalty/stamps", async (request:any, reply:any) => {
    const user = await requireUserFromAuthHeader(request,reply);
    requireRole(user,["OWNER","ADMIN","STAFF"],reply);
    return reply.code(409).send({error:"Stamps are earned only by completing a qualifying visit"});
  });

  app.get("/api/v1/loyalty/me", async (request:any, reply:any) => {
    const user=await requireUserFromAuthHeader(request,reply);requireRole(user,["CUSTOMER"],reply);
    reply.header("Cache-Control","no-store");
    const accounts=await prisma.loyaltyCustomer.findMany({where:{customerId:user.id},include:{card:{include:{salon:{select:{id:true,name:true}}}}},orderBy:{updatedAt:"desc"}});
    const history=await prisma.loyaltyStamp.findMany({where:{customerId:user.id},orderBy:{stampAt:"desc"},take:100});
    return {accounts:accounts.map(a=>({card:{id:a.card.id,salonId:a.card.salonId,salonName:a.card.salon.name,isActive:a.card.isActive,rewardActive:a.card.rewardActive,requiredStamps:a.card.requiredStamps,rewardTitle:a.card.rewardTitle,rewardText:a.card.rewardText},progress:getLoyaltyProgress(a.currentStamps,a.card.requiredStamps),history:history.filter(h=>h.cardId===a.cardId).map(h=>({id:h.id,kind:h.kind,amount:h.amount,at:h.stampAt,rewardTitle:h.rewardTitle}))}))};
  });

  app.get("/api/v1/loyalty/cards/:id/activity",async(request:any,reply:any)=>{
    const user=await requireUserFromAuthHeader(request,reply);requireRole(user,["OWNER","ADMIN"],reply);
    const card=await prisma.loyaltyCard.findUnique({where:{id:request.params.id},include:{salon:{select:{ownerId:true}}}});
    if(!card)return reply.code(404).send({error:"Card not found"});
    if(user.role!=="ADMIN"&&card.salon.ownerId!==user.id)return reply.code(403).send({error:"Forbidden"});
    reply.header("Cache-Control","no-store");
    const history=await prisma.loyaltyStamp.findMany({where:{cardId:card.id},include:{customer:{select:{fullName:true}}},orderBy:{stampAt:"desc"},take:100});
    return {history:history.map(h=>({id:h.id,kind:h.kind,amount:h.amount,at:h.stampAt,rewardTitle:h.rewardTitle,customerName:h.customer.fullName}))};
  });

  app.post("/api/v1/loyalty/cards/:id/redeem",async(request:any,reply:any)=>{
    const user=await requireUserFromAuthHeader(request,reply);requireRole(user,["CUSTOMER"],reply);
    const parsed=z.object({requestId:z.string().uuid()}).strict().safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"Invalid redemption request"});
    try{return await prisma.$transaction(tx=>redeemLoyalty(tx,request.params.id,user.id,parsed.data.requestId));}
    catch(error:any){if(error.statusCode)return reply.code(error.statusCode).send({error:error.message});if(error.code==="P2002")return reply.code(409).send({error:"Redemption already processed"});throw error;}
  });
}
