import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole, requireUserFromAuthHeader } from "../lib/auth.js";
import { getPlatformSettings } from "../lib/platform-settings.js";

const partnerRequestSchema = z.object({
  salonName: z.string().min(2).max(120),
  contactName: z.string().min(2).max(120),
  contactEmail: z.string().email(),
  contactPhone: z.string().max(40).optional(),
  city: z.string().min(2).max(80),
  message: z.string().max(2000).optional(),
}).strict();

const reviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  rejectReason: z.string().max(500).optional(),
}).strict();

const TERMINAL_STATUSES = new Set(["APPROVED", "REJECTED"]);

export async function partnerRequestRoutes(app: any) {
  // Public: submit a salon application (gated by platform setting)
  app.post("/api/v1/partner-requests", async (request: any, reply: any) => {
    const parsed = partnerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid salon application",
        details: parsed.error.flatten(),
      });
    }

    const settings = await getPlatformSettings();
    if (!settings.salonApplicationsEnabled) {
      return reply.code(409).send({
        error: "Salon applications are currently disabled",
        code: "SALON_APPLICATIONS_DISABLED",
      });
    }

    const data = {
      ...parsed.data,
      contactPhone: parsed.data.contactPhone?.trim() || null,
      message: parsed.data.message?.trim() || null,
    };
    const record = await prisma.partnerRequest.create({ data });
    return reply.code(201).send({
      id: record.id,
      status: record.status,
      createdAt: record.createdAt.toISOString(),
      request: {
        id: record.id,
        salonName: record.salonName,
        contactName: record.contactName,
        contactEmail: record.contactEmail,
        contactPhone: record.contactPhone,
        city: record.city,
        message: record.message,
        status: record.status,
        createdAt: record.createdAt.toISOString(),
      },
    });
  });

  // Admin: list all partner requests
  app.get("/api/v1/admin/partner-requests", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      requireRole(user, ["ADMIN"], reply);
      if (reply.sent) return reply;

      const records = await prisma.partnerRequest.findMany({
        orderBy: { createdAt: "desc" },
      });
      return reply.send({ requests: records });
    } catch (error) {
      if (reply.sent) return reply;
      throw error;
    }
  });

  // Admin: review a partner request (approve/reject) with strict state transitions
  app.patch("/api/v1/admin/partner-requests/:id", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      requireRole(user, ["ADMIN"], reply);
      if (reply.sent) return reply;

      const { id } = request.params as { id: string };
      const parsed = reviewSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid review payload",
          details: parsed.error.flatten(),
        });
      }
      const body = parsed.data;

      const existing = await prisma.partnerRequest.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: "Partner request not found" });
      if (TERMINAL_STATUSES.has(String(existing.status || "").toUpperCase())) {
        return reply.code(409).send({
          error: "Request already reviewed",
          code: "INVALID_TRANSITION",
          status: existing.status,
        });
      }

      const record = await prisma.partnerRequest.update({
        where: { id },
        data: {
          status: body.status,
          rejectReason: body.status === "REJECTED" ? body.rejectReason || null : null,
          reviewedByUserId: user.id,
          reviewedAt: new Date(),
        },
      });

      return reply.send({ request: record });
    } catch (error) {
      if (reply.sent) return reply;
      throw error;
    }
  });
}
