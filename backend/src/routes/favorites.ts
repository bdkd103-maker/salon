import { z } from "zod";

import { requireRole, requireUserFromAuthHeader } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

const favoriteParamsSchema = z.object({ salonId: z.string().trim().min(1).max(100) });

// Public salon projection only: never owner e-mail, owner ids or internal flags.
const favoriteSalonSelect = {
  id: true,
  name: true,
  slug: true,
  city: true,
  address: true,
  phone: true,
  description: true,
  isVip: true,
  isWomenOnly: true,
  isVerified: true,
  isActive: true,
  status: true,
  rating: true,
  reviewCount: true,
  openingTime: true,
  closingTime: true,
  workingDays: true,
  timeZone: true,
  media: { select: { id: true, kind: true, url: true } },
};

function serializeFavoriteRow(favorite: any) {
  return {
    id: favorite.id,
    salonId: favorite.salonId,
    createdAt: favorite.createdAt,
    salon: favorite.salon ? { ...favorite.salon, media: favorite.salon.media ?? [] } : null,
  };
}

async function requireFavoriteCustomer(request: any, reply: any) {
  const user = await requireUserFromAuthHeader(request, reply);
  requireRole(user, ["CUSTOMER"], reply);
  return user;
}

export async function favoriteRoutes(app: any) {
  // GET: the authenticated customer's private favorites list
  app.get("/api/v1/favorites", async (request: any, reply: any) => {
    try {
      const user = await requireFavoriteCustomer(request, reply);

      const favorites = await prisma.customerFavorite.findMany({
        where: { userId: user.id, salon: { isActive: true } },
        orderBy: { createdAt: "desc" },
        include: { salon: { select: favoriteSalonSelect } },
      });

      reply.header("Cache-Control", "no-store");
      return { favorites: favorites.map(serializeFavoriteRow) };
    } catch (error) {
      if (reply.sent) return reply;
      request.log?.error?.(error);
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  // GET: is this salon a favorite of the authenticated customer?
  app.get("/api/v1/favorites/:salonId", async (request: any, reply: any) => {
    try {
      const user = await requireFavoriteCustomer(request, reply);
      const params = favoriteParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid salon id" });

      const favorite = await prisma.customerFavorite.findFirst({
        where: { userId: user.id, salonId: params.data.salonId, salon: { isActive: true } },
        select: { id: true },
      });

      reply.header("Cache-Control", "no-store");
      return { favorited: Boolean(favorite), salonId: params.data.salonId };
    } catch (error) {
      if (reply.sent) return reply;
      request.log?.error?.(error);
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  // POST: favorite a visible salon (idempotent, never duplicates a row)
  app.post("/api/v1/favorites/:salonId", async (request: any, reply: any) => {
    try {
      const user = await requireFavoriteCustomer(request, reply);
      const params = favoriteParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid salon id" });

      const salon = await prisma.salon.findFirst({
        where: { id: params.data.salonId, isActive: true },
        select: favoriteSalonSelect,
      });
      if (!salon) return reply.code(404).send({ error: "Salon not found" });

      const favorite = await prisma.customerFavorite.upsert({
        where: { userId_salonId: { userId: user.id, salonId: salon.id } },
        create: { userId: user.id, salonId: salon.id },
        update: {},
        select: { id: true, salonId: true, createdAt: true },
      });

      reply.header("Cache-Control", "no-store");
      return { favorite, salon };
    } catch (error) {
      if (reply.sent) return reply;
      request.log?.error?.(error);
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  // DELETE: remove a favorite (idempotent; removing twice stays safe)
  app.delete("/api/v1/favorites/:salonId", async (request: any, reply: any) => {
    try {
      const user = await requireFavoriteCustomer(request, reply);
      const params = favoriteParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid salon id" });

      const result = await prisma.customerFavorite.deleteMany({
        where: { userId: user.id, salonId: params.data.salonId },
      });

      reply.header("Cache-Control", "no-store");
      return { removed: result.count > 0, salonId: params.data.salonId };
    } catch (error) {
      if (reply.sent) return reply;
      request.log?.error?.(error);
      return reply.code(500).send({ error: "Internal server error" });
    }
  });
}
