import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { createSessionForUser, hashPassword, requireUserFromAuthHeader, sanitizeUser, verifyPassword } from "../lib/auth.js";
import { verifyRefreshToken } from "../lib/jwt.js";

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
  phone: z.string().trim().min(7).max(20).optional().or(z.literal("")),
  role: z.enum(["CUSTOMER", "OWNER"]).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

export async function authRoutes(app: any) {
  app.post("/api/v1/auth/register", async (request: any, reply: any) => {
    const parsed = registerSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const { fullName, email, password, phone, role = "CUSTOMER" } = parsed.data;
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = phone && phone.trim() ? phone.trim() : null;

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      return reply.code(409).send({ error: "User already exists" });
    }

    const user = await prisma.user.create({
      data: {
        fullName,
        email: normalizedEmail,
        phone: normalizedPhone,
        passwordHash: await hashPassword(password),
        role,
      },
    });

    const tokens = await createSessionForUser(user, request);

    return {
      user: sanitizeUser(user),
      ...tokens,
    };
  });

  app.post("/api/v1/auth/login", async (request: any, reply: any) => {
    const parsed = loginSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const { email, password } = parsed.data;
    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (!user || !user.passwordHash) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const validPassword = await verifyPassword(user.passwordHash, password);
    if (!validPassword) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const tokens = await createSessionForUser(user, request);

    return {
      user: sanitizeUser(user),
      ...tokens,
    };
  });

  app.post("/api/v1/auth/refresh", async (request: any, reply: any) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    try {
      const payload = verifyRefreshToken(parsed.data.refreshToken);
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });

      if (!user) {
        return reply.code(401).send({ error: "Invalid refresh token" });
      }

      const session = await prisma.session.findFirst({
        where: {
          userId: user.id,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      });

      if (!session) {
        return reply.code(401).send({ error: "Session expired" });
      }

      const tokens = await createSessionForUser(user, request);
      await prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });

      return {
        user: sanitizeUser(user),
        ...tokens,
      };
    } catch {
      return reply.code(401).send({ error: "Invalid refresh token" });
    }
  });

  app.get("/api/v1/auth/me", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      return { user: sanitizeUser(user) };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.post("/api/v1/auth/logout", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);
      await prisma.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      return { ok: true };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.delete("/api/v1/auth/me", async (request: any, reply: any) => {
    try {
      const user = await requireUserFromAuthHeader(request, reply);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          status: "DELETED",
          deletedAt: new Date(),
          email: `deleted-${user.id}@deleted.local`,
          phone: null,
          fullName: "Deleted User",
          passwordHash: null,
        },
      });

      await prisma.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      return { ok: true };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
}
