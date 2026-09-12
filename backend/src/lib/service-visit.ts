import type { EffectiveStaffPresenceState } from "./staff-presence.js";

export type ServiceVisitSource = "BOOKING" | "WALK_IN";
export type ServiceVisitStatus = "IN_SERVICE" | "COMPLETED" | "CANCELLED";
export type DerivedStaffOccupancy = "BUSY" | "AVAILABLE" | "NOT_AVAILABLE";

type ServiceVisitStartContext = {
  source: ServiceVisitSource;
  salonId: string;
  bookingId: string | null;
  bookingSalonId: string | null;
  staffMembershipId: string;
  membershipId: string;
  membershipSalonId: string;
  membershipStatus: string;
  membershipRevokedAt: Date | null;
  presenceState: EffectiveStaffPresenceState;
};

type ServiceVisitLifecycle = {
  status: ServiceVisitStatus;
  startedAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
  version: number;
};

export function isValidServiceVisitStartContext(context: ServiceVisitStartContext) {
  if (!context.salonId
    || !context.staffMembershipId
    || context.staffMembershipId !== context.membershipId
    || context.membershipSalonId !== context.salonId
    || context.membershipStatus !== "ACTIVE"
    || context.membershipRevokedAt !== null
    || context.presenceState !== "ON_DUTY_CONFIRMED") {
    return false;
  }

  if (context.source === "BOOKING") {
    return Boolean(context.bookingId) && context.bookingSalonId === context.salonId;
  }

  return context.source === "WALK_IN"
    && context.bookingId === null
    && context.bookingSalonId === null;
}

export function isAllowedServiceVisitTransition(
  currentStatus: ServiceVisitStatus,
  nextStatus: ServiceVisitStatus,
) {
  return currentStatus === "IN_SERVICE"
    && (nextStatus === "COMPLETED" || nextStatus === "CANCELLED");
}

export function isValidServiceVisitLifecycle(visit: ServiceVisitLifecycle) {
  const startedAt = visit.startedAt instanceof Date ? visit.startedAt.getTime() : NaN;
  const completedAt = visit.completedAt instanceof Date ? visit.completedAt.getTime() : NaN;
  const cancelledAt = visit.cancelledAt instanceof Date ? visit.cancelledAt.getTime() : NaN;

  if (!Number.isFinite(startedAt) || !Number.isInteger(visit.version) || visit.version < 1) {
    return false;
  }

  if (visit.status === "IN_SERVICE") {
    return visit.completedAt === null && visit.cancelledAt === null;
  }

  if (visit.status === "COMPLETED") {
    return Number.isFinite(completedAt)
      && completedAt >= startedAt
      && visit.cancelledAt === null;
  }

  return visit.status === "CANCELLED"
    && Number.isFinite(cancelledAt)
    && cancelledAt >= startedAt
    && visit.completedAt === null;
}

export function deriveStaffOccupancy(
  presenceState: EffectiveStaffPresenceState,
  hasInServiceVisit: boolean,
): DerivedStaffOccupancy {
  if (hasInServiceVisit) return "BUSY";
  return presenceState === "ON_DUTY_CONFIRMED" ? "AVAILABLE" : "NOT_AVAILABLE";
}