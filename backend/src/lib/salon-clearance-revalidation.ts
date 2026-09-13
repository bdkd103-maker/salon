import type { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { SALON_ARCHIVE_VERSION, SALON_ARCHIVE_PAYLOAD_VERSION } from "./salon-archive.js";
import { loadSalonArchiveState } from "./salon-archive-source.js";

// Required for the current supported contract, not a claim of legal/purge completeness.
export const REQUIRED_ARCHIVE_CATEGORIES = [
  "BOOKING", "SERVICE_VISIT", "SALON_BOOST", "BARBER", "REVIEW", "SALON_MEDIA",
  "SERVICE", "AVAILABILITY", "STAFF_MEMBERSHIP", "STAFF_PRESENCE",
  "QUEUE_ENTRY", "LOYALTY", "OFFER", "ANALYTICS_EVENT", "LIVE_STATUS", "AVAILABILITY_SUBSCRIPTION",
] as const;

function completeCoverage(coverage: Prisma.JsonValue) {
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) return false;
  return isDeepStrictEqual(coverage.categories, [...REQUIRED_ARCHIVE_CATEGORIES]);
}

// Internal boundary for an authenticated ADMIN/server caller. The caller must
// open a Serializable transaction and keep any future deletion in that SAME
// transaction. This result must never be reused as a later preflight token.
// No deletion is performed here. No client-selected clearance/evidence is accepted.
export async function evaluateSalonDeletionReadiness(
  tx: Prisma.TransactionClient, salonId: string, actorUserId: string,
) {
  const clearance = await tx.salonPurgeClearance.findFirst({
    where: { salonId },
    orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
  });
  // Do not fall back to an older clearance when the latest one is revoked/stale.
  if (!clearance) return { ready: false, status: 409, error: "Purge clearance required" } as const;
  const result = await revalidateSalonPurgeClearance(tx, salonId, clearance.id, actorUserId);
  return { ...result, ready: result.valid };
}

// Caller must use a serializable transaction: observation and any revocation commit together.
export async function revalidateSalonPurgeClearance(
  tx: Prisma.TransactionClient, salonId: string, clearanceId: string, actorUserId: string,
) {
  const clearance = await tx.salonPurgeClearance.findUnique({ where: { id: clearanceId } });
  if (!clearance || clearance.salonId !== salonId) {
    return { valid: false, status: 404, error: "Purge clearance not found" } as const;
  }
  if (clearance.revokedAt !== null) {
    return { valid: false, status: 409, error: "Purge clearance is revoked" } as const;
  }
  const refuse = async (reason: string) => {
    await tx.salonPurgeClearance.update({
      where: { id: clearance.id },
      data: { revokedAt: new Date(), revokedByUserId: actorUserId, revocationReason: reason },
    });
    return { valid: false, status: 409, error: reason } as const;
  };
  const salon = await tx.salon.findUnique({ where: { id: salonId }, select: { id: true } });
  if (!salon) return refuse("Salon no longer exists");
  if (await tx.salonRetentionHold.count({ where: { salonId, releasedAt: null } })) {
    return refuse("Active retention hold");
  }
  const archive = await tx.salonArchive.findUnique({ where: { archiveId: clearance.archiveId } });
  if (!archive || archive.salonId !== salonId) return refuse("Archive evidence unavailable");
  if (archive.archiveVersion !== SALON_ARCHIVE_VERSION || clearance.archiveVersion !== SALON_ARCHIVE_VERSION
    || archive.payloadVersion !== SALON_ARCHIVE_PAYLOAD_VERSION || clearance.payloadVersion !== SALON_ARCHIVE_PAYLOAD_VERSION
    || !completeCoverage(archive.coverage) || !completeCoverage(clearance.coverage)) {
    return refuse("Unsupported or incomplete archive coverage");
  }
  if (archive.finalizedAt.getTime() !== clearance.archiveFinalizedAt.getTime()
    || !isDeepStrictEqual(archive.sourceState, clearance.sourceState)
    || !isDeepStrictEqual(archive.coverage, clearance.coverage)) {
    return refuse("Archive evidence changed");
  }
  const current = await loadSalonArchiveState(tx, salonId);
  if (!isDeepStrictEqual(current.sourceState, clearance.sourceState)
    || !isDeepStrictEqual(current.coverage, clearance.coverage)) {
    return refuse("Source state changed");
  }
  return { valid: true, status: 200, clearanceId: clearance.id } as const;
}
