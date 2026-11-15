import { prisma } from "../lib/prisma.js";
import { requireRole, requireUserFromAuthHeader } from "../lib/auth.js";

export async function salonVerificationRoutes(app: any) {
  // Admin: verify a salon
  app.patch("/api/v1/admin/salons/:id/verify", async (request: any, reply: any) => {
    const user = await requireUserFromAuthHeader(request, reply);
    requireRole(user, ["ADMIN"], reply);

    const { id } = request.params as { id: string };
    const existing = await prisma.salon.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Salon not found" });

    const record = await prisma.salon.update({
      where: { id },
      data: { isVerified: true },
    });

    return reply.send({ salon: { id: record.id, isVerified: record.isVerified } });
  });

  // Admin: unverify a salon
  app.patch("/api/v1/admin/salons/:id/unverify", async (request: any, reply: any) => {
    const user = await requireUserFromAuthHeader(request, reply);
    requireRole(user, ["ADMIN"], reply);

    const { id } = request.params as { id: string };
    const existing = await prisma.salon.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Salon not found" });

    const record = await prisma.salon.update({
      where: { id },
      data: { isVerified: false },
    });

    return reply.send({ salon: { id: record.id, isVerified: record.isVerified } });
  });
}
