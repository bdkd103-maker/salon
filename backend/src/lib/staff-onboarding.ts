import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { VerificationError, validateEmailConfig, type EmailConfig } from './verification-email.js';

type Environment = { STAFF_ONBOARDING_ENABLED?: string; STAFF_ACTIVATION_URL?: string };
export function staffOnboardingSettings(env: Environment = process.env) {
  return { enabled: env.STAFF_ONBOARDING_ENABLED === 'true', activationPageUrl: env.STAFF_ACTIVATION_URL };
}

export function validateStaffOnboardingConfiguration(settings: ReturnType<typeof staffOnboardingSettings>, email: EmailConfig) {
  if (!settings.enabled) throw new VerificationError(503, 'STAFF_ONBOARDING_DISABLED', 'Staff onboarding is not enabled.');
  let page: URL;
  try { page = new URL(settings.activationPageUrl || ''); }
  catch { throw new VerificationError(503, 'STAFF_ONBOARDING_UNCONFIGURED', 'An explicit secure Staff activation URL is required.'); }
  if (page.protocol !== 'https:' || page.username || page.password || page.search || page.hash) {
    throw new VerificationError(503, 'STAFF_ONBOARDING_UNCONFIGURED', 'An explicit secure Staff activation URL is required.');
  }
  validateEmailConfig(email);
  return page;
}

const pendingSchema = z.object({
  salonId: z.string().min(1), initiatedByUserId: z.string().min(1),
  destinationEmail: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  intendedUserId: z.string().min(1).nullable().optional(),
  fullName: z.string().trim().min(2).max(80), phone: z.string().trim().max(40).nullable().optional(),
  barberName: z.string().trim().min(1).max(80), secret: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.date(),
}).strict();

/** Internal persistence boundary, NOT an invitation API or authorization service.
 * Future controllers must authorize the Owner/Admin and revalidate account/salon policy.
 * It cannot create users, memberships, sessions, or send mail. No route imports it.
 */
export async function persistPendingStaffInvitation(
  db: { staffInvitation: { create: (args: any) => Promise<any> } },
  input: z.input<typeof pendingSchema>,
  options: { env?: Environment; now?: () => Date } = {},
) {
  if (!staffOnboardingSettings(options.env).enabled) throw new VerificationError(503, 'STAFF_ONBOARDING_DISABLED', 'Staff onboarding is not enabled.');
  const parsed = pendingSchema.safeParse(input);
  if (!parsed.success) throw new VerificationError(400, 'STAFF_INVITATION_INVALID', 'Invalid Staff invitation data.');
  const { secret, ...fields } = parsed.data;
  const at = options.now?.() || new Date();
  if (fields.expiresAt <= at) throw new VerificationError(400, 'STAFF_INVITATION_INVALID', 'Invalid Staff invitation expiry.');
  try {
    return await db.staffInvitation.create({
      data: {
        ...fields, id: randomUUID(), secretDigest: createHash('sha256').update(secret).digest('hex'),
        status: 'PENDING', deliveryState: 'PENDING', generation: 1, sendCount: 0, resendCount: 0,
        createdAt: at, acceptedAt: null, consumedAt: null, revokedAt: null, declinedAt: null,
      },
      // A future Owner response must never contain the secret or its digest.
      select: { id: true, salonId: true, status: true, deliveryState: true, generation: true, expiresAt: true, createdAt: true },
    });
  } catch (error: any) {
    if (error?.code === 'P2002') throw new VerificationError(409, 'STAFF_INVITATION_PENDING', 'A pending Staff invitation already exists.');
    throw error;
  }
}
