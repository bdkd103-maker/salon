import { createRegistrationVerification, serializable } from "../lib/registration-verification.js";
import { createCustomerPasswordReset } from "../lib/customer-password-reset.js";
import { VerificationError } from "../lib/verification-email.js";
import { normalizeGermanPhone } from "../lib/german-phone.js";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { createSessionForUser, hashPassword, requireUserFromAuthHeader, sanitizeUser, verifyPassword } from "../lib/auth.js";
import { verifyRefreshToken } from "../lib/jwt.js";
import { salonImageUrlSchema, serializeSalonMedia, syncSalonPrimaryImage } from "../lib/salon-media.js";
import { MAX_ADMIN_VIP_SLOTS, normalizeSalonClassification } from "../lib/salon-vip.js";
import { salonScheduleFields } from "../lib/salon-schedule.js";

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
  phone: z.string().trim().min(7).max(40),
  verificationToken: z.string().regex(/^[a-f0-9-]{36}\.[a-f0-9]{64}$/),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

const ownerProvisionSchema = z.object({
  owner: z.object({
    fullName: z.string().trim().min(2).max(80),
    email: z.string().trim().email(),
    phone: z.string().trim().min(7).max(20).optional().or(z.literal("")),
    password: z.string().trim().min(8).max(128).optional().or(z.literal("")),
  }),
  salonId: z.string().trim().min(1).optional(),
  salon: z.object({
    name: z.string().trim().min(2).max(120),
    city: z.string().trim().min(2).max(80),
    address: z.string().trim().min(5).max(200),
    phone: z.string().trim().min(7).max(20),
    email: z.string().trim().email().optional().or(z.literal("")),
    website: z.string().trim().url().optional().or(z.literal("")),
    description: z.string().trim().max(1000).optional().or(z.literal("")),
    isVip: z.boolean().optional(),
    adminVip: z.boolean().optional(),
    classification: z.enum(["REGULAR", "PREMIUM"]).optional(),
    isWomenOnly: z.boolean().optional(),
    ...salonScheduleFields,
    imageUrl: salonImageUrlSchema,
  }).optional(),
}).superRefine((value, ctx) => {
  if (!value.salonId && !value.salon) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["salon"],
      message: "Provide either salonId or salon payload",
    });
  }
});

function normalizeOptionalString(value?: string | null) {
  if (!value) return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function buildSalonSlugBase(name: string) {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 54);

  return base || `salon-${Date.now().toString(36)}`;
}

async function createUniqueSalonSlug(db: { salon: { findUnique: (args: any) => Promise<any> } }, name: string) {
  const base = buildSalonSlugBase(name);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const slug = `${base}${suffix}`.slice(0, 64);
    const existing = await db.salon.findUnique({ where: { slug } });
    if (!existing) return slug;
  }

  return `${base.slice(0, 50)}-${Date.now().toString(36)}`.slice(0, 64);
}

async function resolveOwnerPasswordHash(ownerPasswordToSet: string, existingHash?: string | null) {
  if (ownerPasswordToSet && ownerPasswordToSet.length >= 8) {
    return hashPassword(ownerPasswordToSet);
  }

  return existingHash ?? null;
}

function serializeProvisionedSalon(salon: any) {
  return {
    ...salon,
    classification: normalizeSalonClassification(salon?.classification),
    baseClassification: normalizeSalonClassification(salon?.classification),
    vipSource: salon?.adminVip || salon?.isVip ? "ADMIN" : "NONE",
    adminVip: Boolean(salon?.adminVip || salon?.isVip),
    isVip: Boolean(salon?.adminVip || salon?.isVip),
    vip: Boolean(salon?.adminVip || salon?.isVip),
    media: Array.isArray(salon?.media) ? salon.media.map(serializeSalonMedia) : [],
  };
}

async function assertAdminVipCapacity(db: any, options: { ignoreSalonId?: string | null } = {}) {
  const count = await db.salon.count({
    where: options.ignoreSalonId
      ? { adminVip: true, NOT: { id: options.ignoreSalonId } }
      : { adminVip: true },
  });
  if (count >= MAX_ADMIN_VIP_SLOTS) {
    throw Object.assign(new Error(`Only ${MAX_ADMIN_VIP_SLOTS} admin VIP salons can be selected at the same time.`), { statusCode: 409 });
  }
}

function withStalePrismaTypes<T>(value: T) {
  return value as any;
}

export async function authRoutes(
  app: any,
  verification = createRegistrationVerification(prisma),
  passwordReset = createCustomerPasswordReset(prisma),
) {
  function sendVerificationError(error: unknown, reply: any) {
    if (error instanceof VerificationError) {
      if (error.retryAfter) reply.header("Retry-After", String(error.retryAfter));
      return reply.code(error.statusCode).send({ error: error.message, code: error.code });
    }
    return reply.code(503).send({ error: "Email verification is temporarily unavailable.", code: "VERIFICATION_UNAVAILABLE" });
  }
  const requestSchema = z.object({ channel: z.literal("EMAIL"), purpose: z.literal("CUSTOMER_REGISTRATION"), email: z.string().trim().email().max(254).transform(value => value.toLowerCase()) }).strict();
  const resendSchema = z.object({ challengeId: z.string().uuid() }).strict();
  const confirmSchema = resendSchema.extend({ code: z.string().regex(/^\d{6}$/) });
  app.post("/api/v1/auth/verification/request", async (request: any, reply: any) => {
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid email verification request." });
    try { return reply.code(202).send(await verification.request(parsed.data.email, request.ip)); }
    catch (error) { return sendVerificationError(error, reply); }
  });
  app.post("/api/v1/auth/verification/resend", async (request: any, reply: any) => {
    const parsed = resendSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid verification request." });
    try { return reply.code(202).send(await verification.request(null, request.ip, parsed.data.challengeId)); }
    catch (error) { return sendVerificationError(error, reply); }
  });
  app.post("/api/v1/auth/verification/confirm", async (request: any, reply: any) => {
    const parsed = confirmSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Enter the six-digit verification code." });
    try { return await verification.confirm(parsed.data.challengeId, parsed.data.code, request.ip); }
    catch (error) { return sendVerificationError(error, reply); }
  });
  app.post("/api/v1/auth/register", async (request: any, reply: any) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Valid registration details and email verification are required.", details: parsed.error.flatten() });
    const { fullName, email, password, phone, verificationToken } = parsed.data;
    const normalizedEmail = email.trim().toLowerCase();
    let normalizedPhone: string;
    try { normalizedPhone = normalizeGermanPhone(phone); }
    catch { return reply.code(400).send({ error: "Enter a valid German (+49) phone number.", code: "PHONE_INVALID" }); }
    try {
      const passwordHash = await hashPassword(password);
      return await serializable(prisma, async tx => {
        await verification.consume(tx, verificationToken, normalizedEmail);
        const user = await tx.user.create({ data: { fullName, email: normalizedEmail, phone: normalizedPhone, passwordHash, role: "CUSTOMER", emailVerified: true, phoneVerified: false } });
        const tokens = await createSessionForUser(user, request, tx);
        return { user: sanitizeUser(user), ...tokens };
      });
    } catch (error: any) {
      if (error?.code === "P2002") return reply.code(409).send({ error: "User already exists" });
      return sendVerificationError(error, reply);
    }
  });

  const passwordResetRequestSchema = z.object({
    email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  }).strict();
  const passwordResetChallengeSchema = z.object({ challengeId: z.string().uuid() }).strict();
  const passwordResetConfirmSchema = passwordResetChallengeSchema.extend({ code: z.string().regex(/^\d{6}$/) });
  const passwordResetCompleteSchema = z.object({
    resetToken: z.string().regex(/^[a-f0-9-]{36}\.[a-f0-9]{64}$/),
    newPassword: z.string().min(8).max(128),
  }).strict();

  app.post("/api/v1/auth/password-reset/request", async (request: any, reply: any) => {
    const parsed = passwordResetRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Enter a valid email address." });
    try { return reply.code(202).send(await passwordReset.request(parsed.data.email, request.ip)); }
    catch (error) { return sendVerificationError(error, reply); }
  });

  app.post("/api/v1/auth/password-reset/resend", async (request: any, reply: any) => {
    const parsed = passwordResetChallengeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid password reset request." });
    try { return reply.code(202).send(await passwordReset.resend(parsed.data.challengeId, request.ip)); }
    catch (error) { return sendVerificationError(error, reply); }
  });

  app.post("/api/v1/auth/password-reset/confirm", async (request: any, reply: any) => {
    const parsed = passwordResetConfirmSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Enter the six-digit reset code." });
    try { return await passwordReset.confirm(parsed.data.challengeId, parsed.data.code, request.ip); }
    catch (error) { return sendVerificationError(error, reply); }
  });

  app.post("/api/v1/auth/password-reset/complete", async (request: any, reply: any) => {
    const parsed = passwordResetCompleteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Valid reset proof and a new password are required." });
    try { return await passwordReset.complete(parsed.data.resetToken, parsed.data.newPassword, request.ip); }
    catch (error) { return sendVerificationError(error, reply); }
  });

  app.post("/api/v1/auth/admin/provision-owner", async (request: any, reply: any) => {
    let adminUser;

    try {
      adminUser = await requireUserFromAuthHeader(request, reply);
      if (String(adminUser?.role || "").toUpperCase() !== "ADMIN") {
        return reply.code(403).send({ error: "Forbidden" });
      }
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsed = ownerProvisionSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const ownerEmail = parsed.data.owner.email.trim().toLowerCase();
    const ownerPhone = normalizeOptionalString(parsed.data.owner.phone);
    const ownerFullName = parsed.data.owner.fullName.trim();
    const ownerPasswordInput = parsed.data.owner.password;
    const ownerPasswordToSet = typeof ownerPasswordInput === "string" ? ownerPasswordInput.trim() : "";
    const salonPayload = parsed.data.salon;
    const requestedAdminVip = Boolean(salonPayload?.adminVip ?? salonPayload?.isVip);
    const requestedClassification = normalizeSalonClassification(salonPayload?.classification);

    const existingUser = await prisma.user.findUnique({
      where: { email: ownerEmail },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        passwordHash: true,
        ownedSalons: {
          select: { id: true },
          take: 1,
        },
      },
    });
    const reusableOwner = existingUser
      && String(existingUser.role || "").toUpperCase() === "OWNER"
      && String(existingUser.status || "").toUpperCase() === "ACTIVE"
      && Array.isArray(existingUser.ownedSalons)
      && existingUser.ownedSalons.length === 0
      ? existingUser
      : null;
    const passwordResettableOwner = existingUser
      && String(existingUser.role || "").toUpperCase() === "OWNER"
      && String(existingUser.status || "").toUpperCase() === "ACTIVE"
      && Array.isArray(existingUser.ownedSalons)
      && existingUser.ownedSalons.length > 0
      && ownerPasswordToSet.length >= 8
      ? existingUser
      : null;

    if (existingUser && !reusableOwner && !passwordResettableOwner) {
      return reply.code(409).send({ error: "User already exists" });
    }

    if (!existingUser && ownerPasswordToSet.length < 8) {
      return reply.code(400).send({ error: "Owner password is required for new owner provisioning" });
    }

    try {
      if (requestedAdminVip && !passwordResettableOwner) {
        await assertAdminVipCapacity(prisma, { ignoreSalonId: parsed.data.salonId ?? null });
      }
      const result = await prisma.$transaction(async (tx) => {
        if (passwordResettableOwner) {
          const owner = await tx.user.update({
            where: { id: passwordResettableOwner.id },
            data: {
              passwordHash: await hashPassword(ownerPasswordToSet),
            },
          });
          const existingSalonId = passwordResettableOwner.ownedSalons[0]?.id;
          const salon = existingSalonId
            ? await tx.salon.findUnique({
                where: { id: existingSalonId },
                include: { media: true },
              })
            : null;

          if (!salon) {
            const error = new Error("Salon not found");
            (error as any).statusCode = 404;
            throw error;
          }

          return { owner, salon };
        }

        const ownerPasswordHash = await resolveOwnerPasswordHash(ownerPasswordToSet, reusableOwner?.passwordHash);
        if (!ownerPasswordHash) {
          const error = new Error("Owner password is required for new owner provisioning");
          (error as any).statusCode = 400;
          throw error;
        }
        const owner = reusableOwner
          ? await tx.user.update({
              where: { id: reusableOwner.id },
              data: {
                fullName: ownerFullName,
                email: ownerEmail,
                phone: ownerPhone,
                passwordHash: ownerPasswordHash,
                role: "OWNER",
              },
            })
          : await tx.user.create({
              data: {
                fullName: ownerFullName,
                email: ownerEmail,
                phone: ownerPhone,
                passwordHash: ownerPasswordHash,
                role: "OWNER",
              },
            });

        let salon;

        if (parsed.data.salonId) {
          const existingSalon = await tx.salon.findUnique({
            where: { id: parsed.data.salonId },
            select: { id: true },
          });

          if (!existingSalon) {
            const error = new Error("Salon not found");
            (error as any).statusCode = 404;
            throw error;
          }

          salon = await tx.salon.update({
            where: { id: parsed.data.salonId },
            data: {
              ownerId: owner.id,
              ...(salonPayload ? {
                name: salonPayload.name,
                city: salonPayload.city,
                address: salonPayload.address,
                phone: salonPayload.phone,
                email: normalizeOptionalString(salonPayload.email),
                website: normalizeOptionalString(salonPayload.website),
                description: normalizeOptionalString(salonPayload.description),
                isVip: requestedAdminVip,
                adminVip: requestedAdminVip,
                classification: requestedClassification,
                isWomenOnly: salonPayload.isWomenOnly ?? false,
                openingTime: normalizeOptionalString(salonPayload.openingTime),
                closingTime: normalizeOptionalString(salonPayload.closingTime),
                workingDays: salonPayload.workingDays,
                timeZone: salonPayload.timeZone,
              } : {}),
            },
          });
        } else {
          const slug = await createUniqueSalonSlug(tx, salonPayload!.name);
          salon = await tx.salon.create({
            data: withStalePrismaTypes({
              ownerId: owner.id,
              slug,
              name: salonPayload!.name,
              city: salonPayload!.city,
              address: salonPayload!.address,
              phone: salonPayload!.phone,
              email: normalizeOptionalString(salonPayload!.email),
              website: normalizeOptionalString(salonPayload!.website),
              description: normalizeOptionalString(salonPayload!.description),
              isVip: requestedAdminVip,
              adminVip: requestedAdminVip,
              classification: requestedClassification,
              isWomenOnly: salonPayload!.isWomenOnly ?? false,
              openingTime: normalizeOptionalString(salonPayload!.openingTime),
              closingTime: normalizeOptionalString(salonPayload!.closingTime),
              workingDays: salonPayload!.workingDays ?? [],
              timeZone: salonPayload!.timeZone ?? null,
            }),
          });
        }

        if (salonPayload && Object.prototype.hasOwnProperty.call(salonPayload, "imageUrl")) {
          await syncSalonPrimaryImage(tx, salon.id, salonPayload.imageUrl);
        }

        const salonWithMedia = await tx.salon.findUnique({
          where: { id: salon.id },
          include: { media: true },
        });

        return { owner, salon: salonWithMedia ?? salon };
      });

      return {
        owner: sanitizeUser(result.owner),
        salon: serializeProvisionedSalon(result.salon),
      };
    } catch (error) {
      if ((error as any)?.statusCode === 400) {
        return reply.code(400).send({ error: "Owner password is required for new owner provisioning" });
      }

      if ((error as any)?.statusCode === 404) {
        return reply.code(404).send({ error: "Salon not found" });
      }

      if ((error as any)?.code === "P2002") {
        return reply.code(409).send({ error: "Conflict detected" });
      }

      throw error;
    }
  });

  app.post("/api/v1/auth/login", async (request: any, reply: any) => {
    const parsed = loginSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    try {
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
    } catch (error: any) {
      const isDatabaseUnavailable =
        error?.code === "P1001" ||
        error?.code === "P1002" ||
        error?.name === "PrismaClientInitializationError" ||
        error?.name === "PrismaClientKnownRequestError" && /Can't reach database server|ECONNREFUSED|connection/i.test(String(error?.message || ""));

      if (isDatabaseUnavailable) {
        return reply.code(503).send({ error: "The server is temporarily unavailable. Please try again later." });
      }

      throw error;
    }
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
