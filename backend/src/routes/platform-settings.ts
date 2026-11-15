import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole, requireUserFromAuthHeader } from "../lib/auth.js";
import {
  getPlatformSettings,
  safeSecurityInfo,
  safeSystemInfo,
  serializePlatformSettings,
} from "../lib/platform-settings.js";

const settingsPatchSchema = z
  .object({
    siteName: z.string().trim().min(1).max(80).optional(),
    supportEmail: z.string().trim().email().or(z.literal("")).optional(),
    defaultLocale: z.enum(["ar", "de", "en"]).optional(),
    customerRegistrationEnabled: z.boolean().optional(),
    salonApplicationsEnabled: z.boolean().optional(),
    bookingGloballyEnabled: z.boolean().optional(),
    saloTicketGloballyEnabled: z.boolean().optional(),
    walkInGloballyEnabled: z.boolean().optional(),
    staffStatusLiveEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one setting is required",
  });

async function requireAdmin(request: any, reply: any) {
  const user = await requireUserFromAuthHeader(request, reply);
  requireRole(user, ["ADMIN"], reply);
  return user;
}

export async function platformSettingsRoutes(app: any) {
  app.get("/api/v1/platform-settings", async (_request: any, reply: any) => {
    const { id, createdAt, updatedAt, ...settings } = serializePlatformSettings(await getPlatformSettings());
    return reply.header("Cache-Control", "no-store").send({ settings });
  });
  app.get("/api/v1/admin/platform-settings", async (request: any, reply: any) => {
    if (reply.sent) return reply;
    try {
      await requireAdmin(request, reply);
      if (reply.sent) return reply;
      const record = await getPlatformSettings();
      let databaseConnected = true;
      try {
        await prisma.$queryRaw`SELECT 1`;
      } catch {
        databaseConnected = false;
      }
      return reply.send({
        settings: serializePlatformSettings(record),
        system: safeSystemInfo(databaseConnected),
        security: safeSecurityInfo(),
      });
    } catch (error) {
      if (reply.sent) return reply;
      throw error;
    }
  });

  app.patch("/api/v1/admin/platform-settings", async (request: any, reply: any) => {
    if (reply.sent) return reply;
    try {
      await requireAdmin(request, reply);
      if (reply.sent) return reply;
      const parsed = settingsPatchSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid platform settings payload",
          details: parsed.error.flatten(),
        });
      }
      await getPlatformSettings();
      let record;
      try {
        record = await prisma.platformSettings.update({
          where: { id: "platform" },
          data: parsed.data,
        });
      } catch {
        record = await prisma.platformSettings.upsert({
          where: { id: "platform" },
          update: parsed.data,
          create: { id: "platform", ...parsed.data },
        });
      }
      return reply.send({ settings: serializePlatformSettings(record) });
    } catch (error) {
      if (reply.sent) return reply;
      throw error;
    }
  });
}
