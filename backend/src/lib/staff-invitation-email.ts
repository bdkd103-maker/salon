import { VerificationError, type EmailConfig, type VerificationEmailContent } from './verification-email.js';
import { validateStaffOnboardingConfiguration, type staffOnboardingSettings } from './staff-onboarding.js';

/** Pure content preparation for the existing transactional-email transport.
 * No sender or route is wired in this phase; never return this content to an Owner.
 */
export function buildStaffInvitationEmail(
  invitation: { id: string; secret: string; salonName: string; expiresAt: Date; locale?: 'de' | 'en' | 'ar' },
  settings: ReturnType<typeof staffOnboardingSettings>, email: EmailConfig,
): VerificationEmailContent {
  const page = validateStaffOnboardingConfiguration(settings, email);
  if (!/^[a-f0-9]{64}$/.test(invitation.secret) || !invitation.id || !Number.isFinite(invitation.expiresAt.getTime())) {
    throw new VerificationError(400, 'STAFF_INVITATION_INVALID', 'Invalid Staff invitation content.');
  }
  // Fragment keeps the proof out of HTTP request paths and referrers. The future
  // first-party page must clear it immediately and POST it with redacted logging.
  page.hash = new URLSearchParams({ invitation: invitation.id, secret: invitation.secret }).toString();
  const salon = invitation.salonName.replace(/[\r\n]/g, ' ').slice(0, 120);
  const expiry = invitation.expiresAt.toISOString();
  const copy = {
    de: { subject: 'Ihre SALO-Mitarbeitereinladung', text: `Sie wurden zu ${salon} eingeladen. Aktivieren Sie Ihr Konto oder melden Sie sich an, um die Einladung anzunehmen. Wählen Sie Ihr eigenes Passwort.\n${page.href}\nGültig bis ${expiry}. Wenn Sie diese Einladung nicht erwartet haben, ignorieren Sie sie.` },
    en: { subject: 'Your SALO Staff invitation', text: `You have been invited to ${salon}. Activate your account or sign in to accept the invitation. Choose your own password.\n${page.href}\nExpires at ${expiry}. If you did not expect this invitation, ignore it.` },
    ar: { subject: 'دعوتك إلى فريق SALO', text: `تمت دعوتك إلى ${salon}. فعّل حسابك أو سجّل الدخول لقبول الدعوة. اختر كلمة مرورك الخاصة.\n${page.href}\nتنتهي الصلاحية في ${expiry}. تجاهل هذه الدعوة إن لم تكن تتوقعها.` },
  };
  return copy[invitation.locale || 'en'];
}
