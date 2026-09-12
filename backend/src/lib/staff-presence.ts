export type EffectiveStaffPresenceState = "OFF_DUTY" | "ON_DUTY_CONFIRMED" | "STALE";

type StaffMembershipSnapshot = {
  id: string;
  status: string;
  revokedAt: Date | null;
};

type StaffPresenceLeaseSnapshot = {
  staffMembershipId: string;
  generation: number;
  evidenceSource: string;
  producerKey: string;
  observedAt: Date;
  validUntil: Date;
  revokedAt: Date | null;
};

type StaffPresenceSnapshot = {
  staffMembershipId: string;
  dutyState: string;
  generation: number;
  leases: StaffPresenceLeaseSnapshot[];
};

function isValidCurrentLease(
  membershipId: string,
  generation: number,
  lease: StaffPresenceLeaseSnapshot,
  serverNow: number,
) {
  const observedAt = lease.observedAt instanceof Date ? lease.observedAt.getTime() : NaN;
  const validUntil = lease.validUntil instanceof Date ? lease.validUntil.getTime() : NaN;

  return lease.staffMembershipId === membershipId
    && lease.generation === generation
    && lease.revokedAt === null
    && Number.isFinite(observedAt)
    && Number.isFinite(validUntil)
    && observedAt <= serverNow
    && validUntil > serverNow
    && observedAt < validUntil;
}

export function resolveEffectiveStaffPresence(
  membership: StaffMembershipSnapshot | null | undefined,
  presence: StaffPresenceSnapshot | null | undefined,
  serverNow = Date.now(),
): EffectiveStaffPresenceState {
  if (!membership || membership.status !== "ACTIVE" || membership.revokedAt !== null) {
    return "OFF_DUTY";
  }

  if (!presence || presence.staffMembershipId !== membership.id || presence.dutyState !== "ON_DUTY") {
    return "OFF_DUTY";
  }

  if (!Number.isInteger(presence.generation) || presence.generation < 1) {
    return "STALE";
  }

  return Array.isArray(presence.leases) && presence.leases.some((lease) => isValidCurrentLease(
    membership.id,
    presence.generation,
    lease,
    serverNow,
  )) ? "ON_DUTY_CONFIRMED" : "STALE";
}