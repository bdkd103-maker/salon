export class VerificationError extends Error {
  constructor(public statusCode: number, public code: string, message: string, public retryAfter?: number) {
    super(message);
  }
}

export type EmailConfig = { apiKey?: string; from?: string; mode?: string };

export function getEmailConfig(): EmailConfig {
  return { apiKey: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM_EMAIL, mode: process.env.EMAIL_DELIVERY_MODE };
}

export function validateEmailConfig(config: EmailConfig) {
  const sender = config.from?.trim() || "";
  const address = sender.match(/<([^<>]+)>$/)?.[1] || sender;
  if (!config.apiKey || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address) || !["testing", "production"].includes(config.mode || "")) {
    throw new VerificationError(503, "EMAIL_UNAVAILABLE", "Email verification is not configured.");
  }
  if (config.mode === "production" && /@(?:.*\.)?resend\.dev$/i.test(address)) {
    throw new VerificationError(503, "EMAIL_UNAVAILABLE", "A verified production email sender is required.");
  }
}

type VerificationEmailContent = { subject: string; text: string };

// Never log this request or the provider response: both may contain sensitive data.
async function sendCodeEmail(
  destination: string, deliveryId: string, content: VerificationEmailContent,
  config = getEmailConfig(), transport: typeof fetch = fetch,
) {
  validateEmailConfig(config);
  let response: Response;
  try {
    response = await transport("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": deliveryId },
      body: JSON.stringify({ from: config.from, to: [destination], ...content }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new VerificationError(503, "EMAIL_DELIVERY_UNKNOWN", "Email delivery could not be confirmed. Please try again after the resend cooldown.");
  }
  if (!response.ok) {
    const testingRestriction = response.status === 403 && config.mode === "testing";
    throw new VerificationError(503, testingRestriction ? "EMAIL_TESTING_RESTRICTED" : "EMAIL_REJECTED", testingRestriction
      ? "Email testing is restricted to an allowed Resend account recipient; the provider rejected this request."
      : "The email provider rejected the request. Please try again later.");
  }
  const payload = await response.json().catch(() => null) as { id?: string } | null;
  if (!payload?.id || typeof payload.id !== "string") {
    throw new VerificationError(503, "EMAIL_DELIVERY_UNKNOWN", "Email delivery could not be confirmed. Please try again later.");
  }
  return payload.id;
}

export function sendVerificationEmail(
  destination: string, code: string, deliveryId: string,
  config = getEmailConfig(), transport: typeof fetch = fetch,
) {
  return sendCodeEmail(destination, deliveryId, {
    subject: "Confirm your salon account email",
    text: `Your verification code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`,
  }, config, transport);
}

export function sendPasswordResetEmail(
  destination: string, code: string, deliveryId: string,
  config = getEmailConfig(), transport: typeof fetch = fetch,
) {
  return sendCodeEmail(destination, deliveryId, {
    subject: "Reset your salon account password",
    text: `Your password reset code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`,
  }, config, transport);
}
