import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { requireUserFromAuthHeader } from "../lib/auth.js";

const deviceTokenSchema = z.object({
  token: z.string().trim().min(1).max(512),
  platform: z.enum(["android", "ios"]).optional(),
});

export async function deviceTokenRoutes(app: any) {
  app.post("/api/v1/device-tokens", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const parsed = deviceTokenSchema.safeParse(request.body ?? {});

      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const payload = parsed.data;
      const normalizedPlatform = (payload.platform ?? "android").toUpperCase();
      const token = await prisma.deviceToken.upsert({
        where: {
          userId_token: {
            userId: user.id,
            token: payload.token,
          },
        },
        update: {
          platform: normalizedPlatform === "IOS" ? "IOS" : "ANDROID",
          updatedAt: new Date(),
        },
        create: {
          token: payload.token,
          userId: user.id,
          platform: normalizedPlatform === "IOS" ? "IOS" : "ANDROID",
        },
      });

      return { ok: true, token };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.delete("/api/v1/device-tokens", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const token = String(request.body?.token || "").trim();
      if (!token) {
        return reply.code(400).send({ error: "Missing token" });
      }

      await prisma.deviceToken.deleteMany({
        where: { userId: user.id, token },
      });

      return { ok: true };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
}
