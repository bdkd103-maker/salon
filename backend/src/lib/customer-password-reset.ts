import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

import { hashPassword } from "./auth.js";
import { OTP_LIFETIME_MS, RESEND_COOLDOWN_MS, serializable } from "./registration-verification.js";
import { VerificationError, getEmailConfig, sendPasswordResetEmail, validateEmailConfig } from "./verification-email.js";

const RESET_PROOF_LIFETIME_MS = 10 * 60_000;
const invalid = () => new VerificationError(400, "PASSWORD_RESET_INVALID", "Password reset is invalid, expired, or already used. Please request a new code.");
const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");

type Options = {
  now?: () => Date;
  hmacKey?: () => string;
  assertDeliveryConfigured?: () => void;
  send?: (destination: string, code: string, deliveryId: string) => Promise<string>;
  hash?: (password: string) => Promise<string>;
};

export function createCustomerPasswordReset(db: any, options: Options = {}) {
  const now = options.now || (() => new Date());
  const key = options.hmacKey || (() => process.env.VERIFICATION_HMAC_KEY || "");
  const send = options.send || sendPasswordResetEmail;
  const hash = options.hash || hashPassword;
  const assertConfigured = options.assertDeliveryConfigured || (() => validateEmailConfig(getEmailConfig()));
  const digest = (...parts: string[]) => {
    const secret = key();
    if (Buffer.byteLength(secret) < 32) throw new VerificationError(503, "PASSWORD_RESET_UNAVAILABLE", "Password reset is not configured.");
    return createHmac("sha256", secret).update(JSON.stringify(parts)).digest("hex");
  };
  const otpDigest = (challenge: any, code: string) => digest("customer-password-reset-otp", challenge.id, challenge.userId, String(challenge.generation), code);

  async function limit(tx: any, scope: string, identifier: string, max: number, duration: number, at: Date) {
    const id = digest("rate", "customer-password-reset", scope, identifier);
    const bucket = await tx.verificationRateLimitBucket.findUnique({ where: { id } });
    if (bucket && bucket.expiresAt > at) {
      if (bucket.count >= max) {
        throw new VerificationError(429, "PASSWORD_RESET_RATE_LIMIT", "Too many password reset requests. Please wait before trying again.", Math.max(1, Math.ceil((bucket.expiresAt.getTime() - at.getTime()) / 1000)));
      }
      await tx.verificationRateLimitBucket.update({ where: { id }, data: { count: { increment: 1 } } });
      return;
    }
    await tx.verificationRateLimitBucket.upsert({
      where: { id },
      create: { id, count: 1, expiresAt: new Date(at.getTime() + duration) },
      update: { count: 1, expiresAt: new Date(at.getTime() + duration) },
    });
  }

  function accepted(challengeId: string, at: Date) {
    return {
      challengeId,
      status: "accepted",
      expiresAt: new Date(at.getTime() + OTP_LIFETIME_MS),
      resendAvailableAt: new Date(at.getTime() + RESEND_COOLDOWN_MS),
    };
  }

  async function request(email: string, ip: string) {
    assertConfigured();
    digest("configuration-check");
    const at = now();
    const challengeId = randomUUID();
    const code = String(randomInt(100000, 1000000));
    const challenge = await serializable<any>(db, async tx => {
      await limit(tx, "send-ip", ip, 20, 60 * 60_000, at);
      await limit(tx, "send-cooldown", email, 1, RESEND_COOLDOWN_MS, at);
      await limit(tx, "send-hour", email, 5, 60 * 60_000, at);
      await limit(tx, "send-day", email, 10, 24 * 60 * 60_000, at);
      await limit(tx, "resend-challenge", challengeId, 1, RESEND_COOLDOWN_MS, at);

      const user = await tx.user.findUnique({ where: { email } });
      if (!user || String(user.role || "").toUpperCase() !== "CUSTOMER" || String(user.status || "").toUpperCase() !== "ACTIVE") {
        return null;
      }

      await tx.passwordReset.updateMany({
        where: { userId: user.id, usedAt: null, invalidatedAt: null },
        data: { invalidatedAt: at, codeDigest: null },
      });
      const current = {
        id: challengeId,
        userId: user.id,
        tokenHash: tokenHash(randomBytes(32).toString("hex")),
        codeDigest: null as string | null,
        generation: 1,
        deliveryState: "PENDING",
        providerMessageId: null,
        attemptCount: 0,
        sendCount: 1,
        lastSendAt: at,
        verifiedAt: null,
        invalidatedAt: null,
        expiresAt: new Date(at.getTime() + OTP_LIFETIME_MS),
        usedAt: null,
      };
      current.codeDigest = otpDigest(current, code);
      return tx.passwordReset.create({ data: current });
    });

    if (!challenge) return accepted(challengeId, at);

    try {
      const messageId = await send(email, code, `password-reset/${challenge.id}/${challenge.generation}`);
      await db.passwordReset.updateMany({
        where: { id: challenge.id, generation: challenge.generation, deliveryState: "PENDING", invalidatedAt: null },
        data: { deliveryState: "ACCEPTED", providerMessageId: messageId },
      });
    } catch {
      await db.passwordReset.updateMany({
        where: { id: challenge.id, generation: challenge.generation, deliveryState: "PENDING" },
        data: { deliveryState: "FAILED", codeDigest: null },
      }).catch(() => undefined);
    }

    return accepted(challengeId, at);
  }

  async function resend(challengeId: string, ip: string) {
    assertConfigured();
    digest("configuration-check");
    const at = now();
    const code = String(randomInt(100000, 1000000));
    const challenge = await serializable<any>(db, async tx => {
      await limit(tx, "send-ip", ip, 20, 60 * 60_000, at);
      await limit(tx, "resend-challenge", challengeId, 1, RESEND_COOLDOWN_MS, at);
      const previous = await tx.passwordReset.findUnique({ where: { id: challengeId } });
      if (!previous || previous.usedAt || previous.invalidatedAt || previous.verifiedAt || previous.attemptCount >= 5) return null;
      const user = await tx.user.findUnique({ where: { id: previous.userId } });
      if (!user || String(user.role || "").toUpperCase() !== "CUSTOMER" || String(user.status || "").toUpperCase() !== "ACTIVE") return null;
      await limit(tx, "send-hour", user.email, 5, 60 * 60_000, at);
      await limit(tx, "send-day", user.email, 10, 24 * 60 * 60_000, at);
      const current = {
        ...previous,
        generation: previous.generation + 1,
        deliveryState: "PENDING",
        providerMessageId: null,
        sendCount: previous.sendCount + 1,
        lastSendAt: at,
        expiresAt: new Date(at.getTime() + OTP_LIFETIME_MS),
        codeDigest: null as string | null,
      };
      current.codeDigest = otpDigest(current, code);
      return tx.passwordReset.update({ where: { id: previous.id }, data: current });
    });

    if (!challenge) return accepted(challengeId, at);

    try {
      const user = await db.user.findUnique({ where: { id: challenge.userId } });
      if (user?.email) {
        const messageId = await send(user.email, code, `password-reset/${challenge.id}/${challenge.generation}`);
        await db.passwordReset.updateMany({
          where: { id: challenge.id, generation: challenge.generation, deliveryState: "PENDING", invalidatedAt: null },
          data: { deliveryState: "ACCEPTED", providerMessageId: messageId },
        });
      }
    } catch {
      await db.passwordReset.updateMany({
        where: { id: challenge.id, generation: challenge.generation, deliveryState: "PENDING" },
        data: { deliveryState: "FAILED", codeDigest: null },
      }).catch(() => undefined);
    }

    return accepted(challengeId, at);
  }

  async function confirm(challengeId: string, code: string, ip: string) {
    const at = now();
    const secret = randomBytes(32).toString("hex");
    const result = await serializable<any>(db, async tx => {
      await limit(tx, "confirm-ip", ip, 50, 60 * 60_000, at);
      const challenge = await tx.passwordReset.findUnique({ where: { id: challengeId } });
      if (!challenge || challenge.invalidatedAt || challenge.usedAt || challenge.verifiedAt || challenge.deliveryState !== "ACCEPTED" || challenge.expiresAt <= at || challenge.attemptCount >= 5 || !challenge.codeDigest) return null;
      const matches = timingSafeEqual(Buffer.from(challenge.codeDigest, "hex"), Buffer.from(otpDigest(challenge, code), "hex"));
      if (!matches) {
        await tx.passwordReset.update({ where: { id: challenge.id }, data: { attemptCount: { increment: 1 } } });
        return null;
      }
      const expiresAt = new Date(at.getTime() + RESET_PROOF_LIFETIME_MS);
      await tx.passwordReset.update({
        where: { id: challenge.id },
        data: { verifiedAt: at, codeDigest: null, tokenHash: tokenHash(secret), expiresAt },
      });
      return { resetToken: `${challenge.id}.${secret}`, expiresAt };
    });
    if (!result) throw invalid();
    return result;
  }

  async function complete(resetToken: string, password: string, ip = "unknown") {
    const [id, secret] = resetToken.split(".");
    if (!id || !secret || !/^[a-f0-9]{64}$/.test(secret)) throw invalid();
    const at = now();
    await serializable<any>(db, tx => limit(tx, "complete-ip", ip, 20, 60 * 60_000, at));
    const passwordHash = await hash(password);
    return serializable<any>(db, async tx => {
      const challenge = await tx.passwordReset.findUnique({ where: { id } });
      if (!challenge || challenge.invalidatedAt || challenge.usedAt || !challenge.verifiedAt || challenge.expiresAt <= at || challenge.tokenHash !== tokenHash(secret)) throw invalid();
      const user = await tx.user.findUnique({ where: { id: challenge.userId } });
      if (!user || String(user.role || "").toUpperCase() !== "CUSTOMER" || String(user.status || "").toUpperCase() !== "ACTIVE") throw invalid();
      const consumed = await tx.passwordReset.updateMany({
        where: { id, tokenHash: tokenHash(secret), usedAt: null, invalidatedAt: null, expiresAt: { gt: at } },
        data: { usedAt: at, tokenHash: tokenHash(randomBytes(32).toString("hex")) },
      });
      if (consumed.count !== 1) throw invalid();
      await tx.passwordReset.updateMany({
        where: { userId: user.id, id: { not: id }, usedAt: null, invalidatedAt: null },
        data: { invalidatedAt: at, codeDigest: null, tokenHash: tokenHash(randomBytes(32).toString("hex")) },
      });
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: at } });
      return { reset: true };
    });
  }

  return { request, resend, confirm, complete };
}
