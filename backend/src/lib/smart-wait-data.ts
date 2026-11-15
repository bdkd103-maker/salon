/**
 * Loads the real operational data the SMART Wait Engine needs and maps it onto
 * the pure engine inputs. Every query is scoped to the requested salon ids so
 * cross-salon data can never influence a calculation.
 *
 * Real duration data rules:
 * - Queued customers ahead have no service assignment. Their expected service
 *   quantum is the salon's representative configured service duration
 *   (resolveRepresentativeServiceDuration over real Service.durationMin values).
 *   Without any configured service the quantum is unknown and no ETA is produced.
 * - An in-progress ServiceVisit only yields a known remaining time when it has a
 *   real service assignment (Booking -> Service.durationMin). WALK_IN visits
 *   created by the queue start path carry no service, so their remaining time is
 *   UNKNOWN and their lane is excluded instead of being invented.
 */

import { getPlatformSettings } from "./platform-settings.js";
import { getSalonOperatingState } from "./salon-hours.js";
import { deriveStaffOccupancy } from "./service-visit.js";
import { resolveEffectiveStaffPresence } from "./staff-presence.js";
import {
  computeSmartWait,
  projectSmartWaitForPublic,
  resolveRepresentativeServiceDuration,
  type SmartWaitInput,
  type SmartWaitResult,
} from "./smart-wait.js";

export const smartWaitSalonSelect = {
  id: true,
  isActive: true,
  openingTime: true,
  closingTime: true,
  timeZone: true,
  workingDays: true,
  saloTicketIntakeEnabled: true,
  walkInIntakeEnabled: true,
} as const;

export const smartWaitMembershipInclude = {
  presence: { include: { leases: true } },
  serviceVisits: {
    where: { status: "IN_SERVICE" },
    take: 1,
    include: { booking: { select: { service: { select: { durationMin: true } } } } },
  },
} as const;

export const ACTIVE_QUEUE_STATUSES = ["WAITING", "CALLED"] as const;

type SalonHoursRow = {
  id: string;
  name?: string | null;
  isActive?: boolean | null;
  openingTime?: string | null;
  closingTime?: string | null;
  timeZone?: string | null;
  workingDays?: unknown;
  saloTicketIntakeEnabled?: boolean | null;
  walkInIntakeEnabled?: boolean | null;
};

export type PlatformGates = { walkInGloballyEnabled: boolean; saloTicketGloballyEnabled: boolean };

/** Real remaining duration of an active visit. Never inferred from the clock. */
export function resolveVisitDurationMinutes(visit: any): number | null {
  const duration = visit?.booking?.service?.durationMin;
  return typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : null;
}

export function buildSmartWaitStaff(memberships: readonly any[], salonId: string, now: number) {
  return (memberships || [])
    .filter((membership) => membership
      && membership.salonId === salonId
      && membership.status === "ACTIVE"
      && (membership.revokedAt === null || membership.revokedAt === undefined))
    .map((membership) => {
      const presenceState = resolveEffectiveStaffPresence(membership, membership.presence, now);
      const activeVisit = Array.isArray(membership.serviceVisits) ? membership.serviceVisits[0] : null;
      const occupancy = deriveStaffOccupancy(presenceState, Boolean(activeVisit));
      return {
        staffMembershipId: membership.id,
        presenceState,
        occupancy,
        activeVisitStartedAt: activeVisit?.startedAt ?? null,
        activeVisitDurationMinutes: activeVisit ? resolveVisitDurationMinutes(activeVisit) : null,
      };
    });
}

export function buildSmartWaitInput(params: {
  salon: SalonHoursRow;
  memberships: readonly any[];
  serviceDurations: readonly number[];
  queueLength: number | null;
  queueAhead?: number;
  platformSettings: PlatformGates;
  now: number;
}): SmartWaitInput {
  const { salon, memberships, serviceDurations, platformSettings, now } = params;
  const operatingState = getSalonOperatingState(salon, { now: new Date(now) });

  return {
    salonId: salon.id,
    now,
    isActive: salon.isActive !== false,
    isOpenNow: operatingState.isOpen,
    walkInIntakeEnabled: salon.walkInIntakeEnabled !== false,
    saloTicketIntakeEnabled: salon.saloTicketIntakeEnabled !== false,
    walkInGloballyEnabled: platformSettings.walkInGloballyEnabled === true,
    saloTicketGloballyEnabled: platformSettings.saloTicketGloballyEnabled === true,
    representativeServiceDurationMinutes: resolveRepresentativeServiceDuration(serviceDurations),
    staff: buildSmartWaitStaff(memberships, salon.id, now),
    queueAhead: params.queueAhead ?? 0,
    queueLength: params.queueLength ?? null,
  };
}

export function computeWaitForSalon(params: {
  salon: SalonHoursRow;
  memberships: readonly any[];
  serviceDurations: readonly number[];
  queueLength: number | null;
  queueAhead?: number;
  platformSettings: PlatformGates;
  now: number;
}): SmartWaitResult {
  return computeSmartWait(buildSmartWaitInput(params));
}

function summarizeStaff(memberships: readonly any[], serverNow: number) {
  let total = 0;
  let available = 0;
  let busy = 0;
  let notAvailable = 0;
  let stale = 0;

  const staff = (memberships || []).map((membership) => {
    total++;
    const presenceState = resolveEffectiveStaffPresence(membership, membership.presence, serverNow);
    const hasActiveVisit = Array.isArray(membership.serviceVisits) && membership.serviceVisits.length > 0;
    const occupancy = deriveStaffOccupancy(presenceState, hasActiveVisit);
    if (occupancy === "AVAILABLE") available++;
    else if (occupancy === "BUSY") busy++;
    else notAvailable++;
    if (presenceState === "STALE") stale++;
    return { barberName: membership.barber?.name ?? "", occupancy, presenceState };
  });

  return { staff, summary: { total, available, busy, notAvailable, stale } };
}

function buildLiveStatusPayload(params: {
  salon: SalonHoursRow;
  memberships: readonly any[];
  serviceDurations: readonly number[];
  queueLength: number | null;
  platformSettings: PlatformGates;
  serverNow: number;
}) {
  const { salon, memberships, serviceDurations, queueLength, platformSettings, serverNow } = params;
  const { isOpen } = getSalonOperatingState(salon, { now: new Date(serverNow) });
  const { staff, summary } = summarizeStaff(memberships, serverNow);

  let salonStatus: string;
  if (!isOpen) salonStatus = "CLOSED";
  else if (summary.available === 0) salonStatus = summary.busy > 0 ? "BUSY" : "UNCONFIRMED";
  else salonStatus = "OPEN";

  const wait = computeWaitForSalon({ salon, memberships, serviceDurations, queueLength, queueAhead: queueLength ?? 0, platformSettings, now: serverNow });

  const leaseExpiries = (memberships || []).flatMap((membership: any) => (
    membership.presence?.leases
      ?.filter((lease: any) => lease.generation === membership.presence?.generation
        && !lease.revokedAt
        && lease.observedAt.getTime() <= serverNow
        && lease.validUntil.getTime() > serverNow)
      .map((lease: any) => lease.validUntil.getTime()) ?? []
  ));

  return {
    observedAt: new Date(serverNow).toISOString(),
    expiresAt: new Date(Math.min(serverNow + 15000, ...leaseExpiries)).toISOString(),
    salonId: salon.id,
    salonName: salon.name ?? "",
    salonStatus,
    isOpen,
    computedFromRealData: true,
    staffSummary: summary,
    staff,
    wait: projectSmartWaitForPublic(wait),
  };
}

/**
 * Reads the public SMART live status for many salons with a fixed number of
 * queries (never one database waterfall per salon card).
 */
export async function loadLiveStatuses(db: any, salonIds: readonly string[], serverNow: number = Date.now()) {
  const ids = Array.from(new Set((salonIds || []).filter((id) => typeof id === "string" && id)));
  const notFound: string[] = [];
  if (ids.length === 0) return { statuses: [] as any[], notFound };

  const [salons, memberships, serviceRows, queueGroups, platformSettings] = await Promise.all([
    db.salon.findMany({ where: { id: { in: ids } }, select: { ...smartWaitSalonSelect, name: true } }),
    db.staffMembership.findMany({
      where: { salonId: { in: ids }, status: "ACTIVE", revokedAt: null },
      include: {
        presence: smartWaitMembershipInclude.presence,
        barber: true,
        serviceVisits: smartWaitMembershipInclude.serviceVisits,
      },
    }),
    db.service.findMany({
      where: { salonId: { in: ids }, isActive: true },
      select: { salonId: true, durationMin: true },
    }),
    db.queueEntry.groupBy({
      by: ["salonId"],
      where: { salonId: { in: ids }, status: { in: [...ACTIVE_QUEUE_STATUSES] } },
      _count: { _all: true },
    }),
    getPlatformSettings(),
  ]);

  const known = new Set((salons || []).map((salon: any) => salon.id));
  for (const id of ids) if (!known.has(id)) notFound.push(id);

  const durationsBySalon = new Map<string, number[]>();
  for (const row of serviceRows || []) {
    const list = durationsBySalon.get(row.salonId) || [];
    list.push(row.durationMin);
    durationsBySalon.set(row.salonId, list);
  }

  const membershipsBySalon = new Map<string, any[]>();
  for (const membership of memberships || []) {
    const list = membershipsBySalon.get(membership.salonId) || [];
    list.push(membership);
    membershipsBySalon.set(membership.salonId, list);
  }

  const queueBySalon = new Map<string, number>();
  for (const group of queueGroups || []) {
    queueBySalon.set(group.salonId, group._count?._all ?? 0);
  }

  const statuses = (salons || []).map((salon: any) => buildLiveStatusPayload({
    salon,
    memberships: membershipsBySalon.get(salon.id) || [],
    serviceDurations: durationsBySalon.get(salon.id) || [],
    queueLength: queueBySalon.get(salon.id) || 0,
    platformSettings,
    serverNow,
  }));

  // Preserve the caller's request order so the response is deterministic.
  const byId = new Map(statuses.map((status: any) => [status.salonId, status]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);

  return { statuses: ordered, notFound };
}
