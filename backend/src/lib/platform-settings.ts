import { prisma } from "./prisma.js";

export const PLATFORM_SETTINGS_ID = "platform";

export type PlatformSettingsRecord = {
  id: string;
  siteName: string;
  supportEmail: string;
  defaultLocale: string;
  customerRegistrationEnabled: boolean;
  salonApplicationsEnabled: boolean;
  bookingGloballyEnabled: boolean;
  saloTicketGloballyEnabled: boolean;
  walkInGloballyEnabled: boolean;
  staffStatusLiveEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const DEFAULTS = {
  siteName: "SALO",
  supportEmail: "",
  defaultLocale: "ar",
  customerRegistrationEnabled: true,
  salonApplicationsEnabled: true,
  bookingGloballyEnabled: true,
  saloTicketGloballyEnabled: true,
  walkInGloballyEnabled: true,
  staffStatusLiveEnabled: true,
};

export async function getPlatformSettings(): Promise<PlatformSettingsRecord> {
  const existing = await prisma.platformSettings.findUnique({ where: { id: PLATFORM_SETTINGS_ID } });
  if (existing) return existing;
  // Defaults become operational only after PostgreSQL has persisted them.
  return prisma.platformSettings.upsert({
    where: { id: PLATFORM_SETTINGS_ID },
    update: {},
    create: { id: PLATFORM_SETTINGS_ID, ...DEFAULTS },
  });
}

export function serializePlatformSettings(record: PlatformSettingsRecord) {
  return {
    id: record.id,
    siteName: record.siteName,
    supportEmail: record.supportEmail,
    defaultLocale: record.defaultLocale,
    customerRegistrationEnabled: record.customerRegistrationEnabled,
    salonApplicationsEnabled: record.salonApplicationsEnabled,
    bookingGloballyEnabled: record.bookingGloballyEnabled,
    saloTicketGloballyEnabled: record.saloTicketGloballyEnabled,
    walkInGloballyEnabled: record.walkInGloballyEnabled,
    staffStatusLiveEnabled: record.staffStatusLiveEnabled,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** Safe system diagnostics for Admin UI. Never includes secrets or credentials. */
export function safeSystemInfo(databaseConnected: boolean) {
  return {
    environment: process.env.NODE_ENV || "development",
    apiVersion: "v1",
    nodeVersion: process.version,
    processUptimeSeconds: Math.floor(process.uptime()),
    databaseConnected,
    serverTime: new Date().toISOString(),
  };
}

/** Informational-only security posture for Admin UI. Never includes secrets. */
export function safeSecurityInfo() {
  return {
    authentication: "JWT Bearer access tokens with server-side session records",
    passwordHashing: "Argon2id",
    passwordMinLength: 8,
    rateLimitPerMinute: 100,
    adminAuthorization: "ADMIN role required for platform settings and partner review",
    secretsExposed: false,
    notes: "Credentials, tokens, and private keys are never returned by this endpoint.",
  };
}
