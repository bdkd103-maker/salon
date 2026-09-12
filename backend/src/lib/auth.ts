import argon2 from "argon2";

import { prisma } from "./prisma.js";
import { signAccessToken, signRefreshToken, verifyAccessToken } from "./jwt.js";

export async function hashPassword(password: string) {
  return argon2.hash(password);
}

export async function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password);
}

export function sanitizeUser<T extends { passwordHash?: string | null; deletedAt?: Date | null }>(user: T) {
  const { passwordHash, deletedAt, ...safeUser } = user;
  return safeUser;
}

export async function createSessionForUser(user: { id: string; role: string }, request: { headers: Record<string, string | string[] | undefined>; ip: string }, db: Pick<typeof prisma, "session"> = prisma) {
  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  const refreshToken = signRefreshToken({ sub: user.id });

  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: await argon2.hash(refreshToken),
      refreshToken,
      userAgent: Array.isArray(request.headers["user-agent"]) ? request.headers["user-agent"][0] ?? null : request.headers["user-agent"] ?? null,
      ipAddress: request.ip,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
    },
  });

  return { accessToken, refreshToken };
}

export async function requireUserFromAuthHeader(request: { headers: Record<string, string | string[] | undefined> }, reply: { code: (status: number) => { send: (payload: { error: string }) => never }}) {
  const authorization = request.headers.authorization;
  const headerValue = Array.isArray(authorization) ? authorization[0] : authorization;

  if (!headerValue || !headerValue.startsWith("Bearer ")) {
    throw reply.code(401).send({ error: "Unauthorized" });
  }

  const token = headerValue.slice("Bearer ".length);

  try {
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });

    if (!user || user.status === "DELETED") {
      throw reply.code(401).send({ error: "Unauthorized" });
    }

    return user;
  } catch {
    throw reply.code(401).send({ error: "Unauthorized" });
  }
}

export function requireRole<T extends { role?: string | null }>(
  user: T | null,
  allowedRoles: Array<string | undefined | null>,
  reply: { code: (status: number) => { send: (payload: { error: string }) => never } },
) {
  if (!user) {
    throw reply.code(401).send({ error: "Unauthorized" });
  }

  const normalizedRole = String(user.role ?? "").toUpperCase();
  const hasAccess = allowedRoles.some((role) => String(role ?? "").toUpperCase() === normalizedRole);

  if (!hasAccess) {
    throw reply.code(403).send({ error: "Forbidden" });
  }

  return user;
}
