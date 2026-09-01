import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { requireUserFromAuthHeader } from "../lib/auth.js";

const consentSchema = z.object({
  consent: z.boolean(),
  source: z.enum(["booking", "contact", "account"]).optional(),
});

export async function privacyRoutes(app: any) {
  app.get("/api/v1/privacy/consent", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const consent = await prisma.notification.findFirst({
        where: { userId: user.id, type: "gdpr" },
      });

      return { consent: Boolean(consent) };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.post("/api/v1/privacy/consent", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      const parsed = consentSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      await prisma.notification.create({
        data: {
          userId: user.id,
          title: "GDPR consent",
          body: parsed.data.consent ? "User accepted GDPR processing consent" : "User rejected consent",
          type: "gdpr",
          metadata: { consent: parsed.data.consent, source: parsed.data.source ?? "account" },
        },
      });

      return { ok: true };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
}
