import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole, requireUserFromAuthHeader } from "../lib/auth.js";

const globalOfferSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  priceText: z.string().max(60).optional(),
  isActive: z.boolean().optional(),
}).strict();

export async function globalOfferRoutes(app: any) {
  // Public: get active global offers
  app.get("/api/v1/global-offers", async (_request: any, reply: any) => {
    const offers = await prisma.globalOffer.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({ offers });
  });

  // Admin: list all global offers
  app.get("/api/v1/admin/global-offers", async (request: any, reply: any) => {
    const user = await requireUserFromAuthHeader(request, reply);
    requireRole(user, ["ADMIN"], reply);

    const offers = await prisma.globalOffer.findMany({
      orderBy: { createdAt: "desc" },
    });
    return reply.send({ offers });
  });

  // Admin: create a global offer
  app.post("/api/v1/admin/global-offers", async (request: any, reply: any) => {
    const user = await requireUserFromAuthHeader(request, reply);
    requireRole(user, ["ADMIN"], reply);

    const body = globalOfferSchema.parse(request.body);
    const record = await prisma.globalOffer.create({ data: body });
    return reply.code(201).send({ offer: record });
  });

  // Admin: update a global offer
  app.patch("/api/v1/admin/global-offers/:id", async (request: any, reply: any) => {
    const user = await requireUserFromAuthHeader(request, reply);
    requireRole(user, ["ADMIN"], reply);

    const { id } = request.params as { id: string };
    const body = globalOfferSchema.partial().parse(request.body);

    const existing = await prisma.globalOffer.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Global offer not found" });

    const record = await prisma.globalOffer.update({ where: { id }, data: body });
    return reply.send({ offer: record });
  });

  // Admin: delete a global offer
  app.delete("/api/v1/admin/global-offers/:id", async (request: any, reply: any) => {
    const user = await requireUserFromAuthHeader(request, reply);
    requireRole(user, ["ADMIN"], reply);

    const { id } = request.params as { id: string };
    const existing = await prisma.globalOffer.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Global offer not found" });

    await prisma.globalOffer.delete({ where: { id } });
    return reply.send({ deleted: true });
  });
}
