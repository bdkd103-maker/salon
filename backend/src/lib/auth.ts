import argon2 from "argon2";
import { randomBytes, randomUUID } from "node:crypto";

import { prisma } from "./prisma.js";
import { signAccessToken, signRefreshToken, verifyAccessToken } from "./jwt.js";
import { accessTokenVersionMatches } from "./auth-version.js";

export async function hashPassword(password: string) {
  return argon2.hash(password);
}

export async function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password);
}

export function sanitizeUser<T extends { passwordHash?: string | null; deletedAt?: Date | null; authVersion?: number; staffPasswordChangeRequired?: boolean }>(user: T) {
  const { passwordHash, deletedAt, authVersion, staffPasswordChangeRequired, ...safeUser } = user;
  return safeUser;
}

export async function createSessionForUser(user: { id: string; role: string; authVersion?: number }, request: { headers: Record<string, string | string[] | undefined>; ip: string }, db: Pick<typeof prisma, "session"> = prisma) {
  const accessToken = signAccessToken({ sub: user.id, role: user.role, authVersion: user.authVersion });

  const sessionId = randomUUID();
  const jti = randomBytes(16).toString("hex");
  const refreshToken = signRefreshToken({ sub: user.id, sid: sessionId, jti });
  const tokenHash = await argon2.hash(refreshToken);

  await db.session.create({
    data: {
      id: sessionId,
      userId: user.id,
      tokenHash,
      userAgent: Array.isArray(request.headers["user-agent"]) ? request.headers["user-agent"][0] ?? null : request.headers["user-agent"] ?? null,
      ipAddress: request.ip,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
    },
  });

  return { accessToken, refreshToken };
}

export async function requireUserFromAuthHeader(request: { headers: Record<string, string | string[] | undefined> }, reply: { code: (status: number) => { send: (payload: { error: string }) => unknown }}, options?: { allowRestrictedAccount: true }) {
  // Only logout, consent management and self-deletion opt into restricted access.
  // Read-only auth/me and profile/me deliberately remain ACTIVE-only.
  // Existing route catches rely on reply.sent. Send once, then stop execution
  // with an Error (not the Reply, whose statusCode can trigger another send).
  const unauthorized = () => {
    reply.code(401).send({ error: "Unauthorized" });
    return new Error("Unauthorized");
  };
  const authorization = request.headers.authorization;
  const headerValue = Array.isArray(authorization) ? authorization[0] : authorization;

  if (!headerValue || !headerValue.startsWith("Bearer ")) {
    throw unauthorized();
  }

  const token = headerValue.slice("Bearer ".length);

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw unauthorized();
  }
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !accessTokenVersionMatches(payload, user)) throw unauthorized();
  const allowed = user.status === "ACTIVE" ||
    (options?.allowRestrictedAccount === true && (user.status === "INACTIVE" || user.status === "SUSPENDED"));
  if (!allowed) throw unauthorized();
  return user;
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
