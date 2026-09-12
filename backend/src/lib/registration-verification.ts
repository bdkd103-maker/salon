import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { VerificationError, getEmailConfig, sendVerificationEmail, validateEmailConfig } from "./verification-email.js";

export const OTP_LIFETIME_MS = 10 * 60_000;
export const RESEND_COOLDOWN_MS = 60_000;
const invalid = () => new VerificationError(400, "VERIFICATION_INVALID", "Verification is invalid, expired, or already used. Please request a new code.");
const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function serializable<T>(db: any, operation: (tx: any) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(operation, { isolationLevel: "Serializable" }); }
    catch (error: any) { if (error?.code !== "P2034" || attempt >= 3) throw error; }
  }
}

type Options = {
  now?: () => Date;
  hmacKey?: () => string;
  assertDeliveryConfigured?: () => void;
  send?: (destination: string, code: string, deliveryId: string) => Promise<string>;
};

export function createRegistrationVerification(db: any, options: Options = {}) {
  const now = options.now || (() => new Date());
  const key = options.hmacKey || (() => process.env.VERIFICATION_HMAC_KEY || "");
  const send = options.send || sendVerificationEmail;
  const assertConfigured = options.assertDeliveryConfigured || (() => validateEmailConfig(getEmailConfig()));
  const digest = (...parts: string[]) => {
    const secret = key();
    if (Buffer.byteLength(secret) < 32) throw new VerificationError(503, "VERIFICATION_UNAVAILABLE", "Email verification is not configured.");
    return createHmac("sha256", secret).update(JSON.stringify(parts)).digest("hex");
  };
  const otpDigest = (c: any, code: string) => digest("otp", c.id, c.channel, c.purpose, c.destination, String(c.generation), code);

  async function limit(tx: any, scope: string, identifier: string, max: number, duration: number, at: Date) {
    const id = digest("rate", scope, identifier);
    const bucket = await tx.verificationRateLimitBucket.findUnique({ where: { id } });
    if (bucket && bucket.expiresAt > at) {
      if (bucket.count >= max) throw new VerificationError(429, "VERIFICATION_RATE_LIMIT", "Too many verification requests. Please wait before trying again.", Math.max(1, Math.ceil((bucket.expiresAt.getTime() - at.getTime()) / 1000)));
      await tx.verificationRateLimitBucket.update({ where: { id }, data: { count: { increment: 1 } } });
    } else {
      await tx.verificationRateLimitBucket.upsert({ where: { id }, create: { id, count: 1, expiresAt: new Date(at.getTime() + duration) }, update: { count: 1, expiresAt: new Date(at.getTime() + duration) } });
    }
  }

  async function request(email: string | null, ip: string, challengeId?: string) {
    assertConfigured();
    digest("configuration-check");
    const at = now();
    const code = String(randomInt(100000, 1000000));
    const challenge = await serializable<any>(db, async tx => {
      const previous = challengeId ? await tx.registrationVerificationChallenge.findUnique({ where: { id: challengeId } }) : null;
      if (challengeId && (!previous || previous.consumedAt || previous.invalidatedAt || previous.attemptCount >= 5 || previous.verifiedAt)) throw invalid();
      const destination = previous?.destination || email;
      if (!destination) throw invalid();
      await limit(tx, "send-ip", ip, 20, 60 * 60_000, at);
      await limit(tx, "send-cooldown", destination, 1, RESEND_COOLDOWN_MS, at);
      await limit(tx, "send-hour", destination, 5, 60 * 60_000, at);
      await limit(tx, "send-day", destination, 10, 24 * 60 * 60_000, at);
      const current = {
        id: previous?.id || randomUUID(), channel: "EMAIL", purpose: "CUSTOMER_REGISTRATION", destination,
        generation: (previous?.generation || 0) + 1, deliveryState: "PENDING", providerMessageId: null,
        expiresAt: new Date(at.getTime() + OTP_LIFETIME_MS), lastSendAt: at,
        attemptCount: previous?.attemptCount || 0, sendCount: (previous?.sendCount || 0) + 1,
        verifiedAt: null, registrationTokenHash: null, registrationTokenExpiresAt: null, consumedAt: null, invalidatedAt: null,
      };
      // A new challenge supersedes earlier challenges for this destination.
      await tx.registrationVerificationChallenge.updateMany({ where: { destination, purpose: current.purpose, consumedAt: null, invalidatedAt: null, ...(previous ? { id: { not: previous.id } } : {}) }, data: { invalidatedAt: at, codeDigest: null, registrationTokenHash: null } });
      const data = { ...current, codeDigest: otpDigest(current, code) };
      return tx.registrationVerificationChallenge.upsert({ where: { id: current.id }, create: data, update: data });
    });
    let messageId: string;
    try {
      messageId = await send(challenge.destination, code, `registration/${challenge.id}/${challenge.generation}`);
    } catch (error) {
      await db.registrationVerificationChallenge.updateMany({ where: { id: challenge.id, generation: challenge.generation, deliveryState: "PENDING" }, data: { deliveryState: error instanceof VerificationError && error.code === "EMAIL_DELIVERY_UNKNOWN" ? "UNKNOWN" : "FAILED", codeDigest: null } });
      if (error instanceof VerificationError) throw error;
      throw new VerificationError(503, "EMAIL_UNAVAILABLE", "Email delivery is unavailable. Please try again later.");
    }
    const accepted = await db.registrationVerificationChallenge.updateMany({ where: { id: challenge.id, generation: challenge.generation, deliveryState: "PENDING", invalidatedAt: null }, data: { deliveryState: "ACCEPTED", providerMessageId: messageId } });
    if (accepted.count !== 1) throw invalid();
    return { challengeId: challenge.id, status: "accepted", expiresAt: challenge.expiresAt, resendAvailableAt: new Date(at.getTime() + RESEND_COOLDOWN_MS) };
  }

  async function confirm(challengeId: string, code: string, ip: string) {
    const at = now();
    const secret = randomBytes(32).toString("hex");
    const result = await serializable<any>(db, async tx => {
      await limit(tx, "confirm-ip", ip, 50, 60 * 60_000, at);
      const c = await tx.registrationVerificationChallenge.findUnique({ where: { id: challengeId } });
      if (!c || c.invalidatedAt || c.consumedAt || c.verifiedAt || c.deliveryState !== "ACCEPTED" || c.expiresAt <= at || c.attemptCount >= 5 || !c.codeDigest) return null;
      const matches = timingSafeEqual(Buffer.from(c.codeDigest, "hex"), Buffer.from(otpDigest(c, code), "hex"));
      if (!matches) {
        await tx.registrationVerificationChallenge.update({ where: { id: c.id }, data: { attemptCount: { increment: 1 } } });
        return null; // Commit failed attempts; throwing here would roll them back.
      }
      const expiresAt = new Date(at.getTime() + OTP_LIFETIME_MS);
      await tx.registrationVerificationChallenge.update({ where: { id: c.id }, data: { verifiedAt: at, codeDigest: null, registrationTokenHash: tokenHash(secret), registrationTokenExpiresAt: expiresAt } });
      return { verificationToken: `${c.id}.${secret}`, expiresAt };
    });
    if (!result) throw invalid();
    return result;
  }

  // Called inside the account/session creation transaction.
  async function consume(tx: any, verificationToken: string, email: string) {
    const [id, secret] = verificationToken.split(".");
    if (!id || !secret || !/^[a-f0-9]{64}$/.test(secret)) throw invalid();
    const result = await tx.registrationVerificationChallenge.updateMany({ where: {
      id, destination: email, channel: "EMAIL", purpose: "CUSTOMER_REGISTRATION", deliveryState: "ACCEPTED",
      verifiedAt: { not: null }, consumedAt: null, invalidatedAt: null,
      registrationTokenHash: tokenHash(secret), registrationTokenExpiresAt: { gt: now() },
    }, data: { consumedAt: now(), registrationTokenHash: null } });
    if (result.count !== 1) throw invalid();
  }

  return { request, confirm, consume };
}
