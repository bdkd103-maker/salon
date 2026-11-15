/**
 * SALO SMART WAIT ENGINE (deterministic, read-only, derived state).
 *
 * Design contract:
 * - Uses ONLY real operational data that already exists: salon opening/intake
 *   configuration, StaffMembership + StaffPresence (lease-confirmed), active
 *   ServiceVisit start timestamps, real configured Service.durationMin values
 *   and the real QueueEntry lifecycle/order.
 * - Service duration is NEVER treated as availability. Occupancy stays
 *   authoritative (StaffPresence + active ServiceVisit); the clock only
 *   projects when a lane *may* become free.
 * - When a remaining duration cannot be derived from real data, no minutes are
 *   invented. The affected lane is excluded from usable capacity and the wait
 *   state falls back to WAIT_UNKNOWN instead of a fabricated number.
 * - Result is derived on every read. Nothing is persisted as a countdown.
 *
 * Staff capability limitation: the data model has no service-to-staff
 * capability mapping (StaffMembership -> Barber only, Barber.specialty is free
 * text). Every confirmed ACTIVE staff member of the salon is therefore treated
 * as an interchangeable lane (salon-level eligibility). No specialization is
 * invented here.
 */

import type { DerivedStaffOccupancy } from "./service-visit.js";
import type { EffectiveStaffPresenceState } from "./staff-presence.js";

export type SmartWaitState =
  | "CLOSED"
  | "WALK_IN_DISABLED"
  | "STAFF_STATUS_UNCONFIRMED"
  | "AVAILABLE_NOW"
  | "ESTIMATED_WAIT"
  | "WAIT_UNKNOWN";

export const SMART_WAIT_STATES: readonly SmartWaitState[] = [
  "CLOSED",
  "WALK_IN_DISABLED",
  "STAFF_STATUS_UNCONFIRMED",
  "AVAILABLE_NOW",
  "ESTIMATED_WAIT",
  "WAIT_UNKNOWN",
];

/** Deterministic human-friendly rounding step, in minutes. */
export const SMART_WAIT_ROUNDING_STEP_MINUTES = 5;

export type SmartWaitStaffInput = {
  staffMembershipId: string;
  presenceState: EffectiveStaffPresenceState;
  occupancy: DerivedStaffOccupancy;
  activeVisitStartedAt: Date | number | null;
  activeVisitDurationMinutes: number | null;
};

export type SmartWaitInput = {
  salonId: string;
  now?: number;
  isActive: boolean;
  isOpenNow: boolean;
  walkInIntakeEnabled: boolean;
  saloTicketIntakeEnabled: boolean;
  walkInGloballyEnabled: boolean;
  saloTicketGloballyEnabled: boolean;
  /** Real configured salon service duration, or null when none is configured. */
  representativeServiceDurationMinutes: number | null;
  staff: readonly SmartWaitStaffInput[];
  /** WAITING/CALLED entries that must be served before the observed customer. */
  queueAhead: number;
  /** WAITING/CALLED entries in the salon. Only known by the caller, optional. */
  queueLength?: number | null;
};

export type SmartWaitResult = {
  salonId: string;
  state: SmartWaitState;
  /** true only for AVAILABLE_NOW / ESTIMATED_WAIT. */
  reliable: boolean;
  /** null unless the state is AVAILABLE_NOW (0) or ESTIMATED_WAIT. */
  etaMinutes: number | null;
  queueAhead: number;
  queueLength: number | null;
  confirmedWorkingStaff: number;
  availableStaff: number;
  busyStaff: number;
  /** Confirmed lanes the estimate is allowed to use. */
  confirmedCapacity: number;
  walkInEnabled: boolean;
  serviceDurationMinutes: number | null;
  calculatedAt: string;
};

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Rounding rule (deterministic, documented):
 *   0 minutes or less  -> 0 (rendered as AVAILABLE_NOW, never "0 min")
 *   anything positive  -> nearest multiple of 5 minutes, never below 5
 * Example: 13 min -> 15 min, 12 min -> 10 min, 1 min -> 5 min.
 */
export function roundWaitMinutes(deltaMs: number): number {
  const numeric = toFiniteNumber(deltaMs);
  if (numeric === null || numeric <= 0) return 0;
  const rawMinutes = numeric / 60000;
  const rounded = Math.round(rawMinutes / SMART_WAIT_ROUNDING_STEP_MINUTES) * SMART_WAIT_ROUNDING_STEP_MINUTES;
  return Math.max(SMART_WAIT_ROUNDING_STEP_MINUTES, rounded);
}

/**
 * Representative configured service duration for a salon: the lower median of
 * its active Service.durationMin values. Real salon configuration only; null
 * when the salon has no active service configured (then no duration may be
 * assumed anywhere in the engine).
 */
export function resolveRepresentativeServiceDuration(configuredMinutes: readonly number[]): number | null {
  const values = (configuredMinutes || [])
    .map((value) => toFiniteNumber(value))
    .filter((value): value is number => value !== null && value > 0)
    .sort((a, b) => a - b);
  if (values.length === 0) return null;
  return values[Math.floor((values.length - 1) / 2)];
}

type Lane = { key: string; availableAt: number };

function earliestLaneIndex(lanes: readonly Lane[]): number {
  let best = 0;
  for (let index = 1; index < lanes.length; index++) {
    const candidate = lanes[index];
    const current = lanes[best];
    if (
      candidate.availableAt < current.availableAt
      || (candidate.availableAt === current.availableAt && candidate.key < current.key)
    ) {
      best = index;
    }
  }
  return best;
}

function finish(
  input: SmartWaitInput,
  now: number,
  state: SmartWaitState,
  etaMinutes: number | null,
  counters: {
    confirmedWorkingStaff: number;
    availableStaff: number;
    busyStaff: number;
    confirmedCapacity: number;
    queueLength: number | null;
    walkInEnabled: boolean;
    serviceDurationMinutes: number | null;
  },
): SmartWaitResult {
  return {
    salonId: input.salonId,
    state,
    reliable: state === "AVAILABLE_NOW" || state === "ESTIMATED_WAIT",
    etaMinutes,
    queueAhead: input.queueAhead,
    queueLength: counters.queueLength,
    confirmedWorkingStaff: counters.confirmedWorkingStaff,
    availableStaff: counters.availableStaff,
    busyStaff: counters.busyStaff,
    confirmedCapacity: counters.confirmedCapacity,
    walkInEnabled: counters.walkInEnabled,
    serviceDurationMinutes: counters.serviceDurationMinutes,
    calculatedAt: new Date(now).toISOString(),
  };
}

/**
 * Multi-server (multi-lane) deterministic wait calculation.
 *
 * Lanes:
 *   - AVAILABLE (confirmed on duty, no active visit)  -> availableAt = now
 *   - BUSY with derivable remaining time              -> availableAt = startedAt + duration
 *   - BUSY without derivable remaining time           -> EXCLUDED (never invented)
 *   - OFF_DUTY / STALE (NOT_AVAILABLE)                -> not a lane at all
 *
 * Allocation: WAITING/CALLED customers ahead are placed in queue order onto the
 * lane that becomes available earliest (ties broken by staffMembershipId, so the
 * result is deterministic). The observed customer gets the earliest lane after
 * every customer ahead has been placed. The observed customer does not consume
 * lane time - the ETA is the wait until service can START.
 *
 * Unknown-capacity lanes are excluded. Estimates use known lanes and the
 * configured duration proxy; they are not guaranteed completion times.
 */
export function computeSmartWait(input: SmartWaitInput): SmartWaitResult {
  const now = toFiniteNumber(input.now) ?? Date.now();
  const staff = Array.isArray(input.staff) ? input.staff : [];
  const queueAhead = Math.max(0, Math.floor(toFiniteNumber(input.queueAhead) ?? 0));
  const rawDuration = toFiniteNumber(input.representativeServiceDurationMinutes);
  const serviceDurationMinutes = rawDuration !== null && rawDuration > 0 ? rawDuration : null;

  let confirmedWorkingStaff = 0;
  let availableStaff = 0;
  let busyStaff = 0;

  const lanes: Lane[] = [];

  const orderedStaff = staff
    .slice()
    .sort((a, b) => String(a.staffMembershipId).localeCompare(String(b.staffMembershipId)));

  for (const member of orderedStaff) {
    if (member.presenceState !== "ON_DUTY_CONFIRMED") continue;
    if (member.occupancy === "AVAILABLE") {
      confirmedWorkingStaff++;
      availableStaff++;
      lanes.push({ key: String(member.staffMembershipId), availableAt: now });
      continue;
    }
    if (member.occupancy === "BUSY") {
      confirmedWorkingStaff++;
      busyStaff++;
      const startedAt = toFiniteNumber(member.activeVisitStartedAt);
      const durationMinutes = toFiniteNumber(member.activeVisitDurationMinutes);
      if (startedAt !== null && startedAt <= now && durationMinutes !== null && durationMinutes > 0
        && startedAt + durationMinutes * 60000 > now) {
        lanes.push({
          key: String(member.staffMembershipId),
          availableAt: startedAt + durationMinutes * 60000,
        });
      }
      // Unknown remaining time: the lane is intentionally not usable. No minutes
      // are invented for it, and it can never make the estimate look better.
      continue;
    }
    // NOT_AVAILABLE: stale or off-duty presence without an active visit.
  }

  const walkInEnabled = Boolean(
    input.isActive
    && input.walkInIntakeEnabled
    && input.saloTicketIntakeEnabled
    && input.walkInGloballyEnabled
    && input.saloTicketGloballyEnabled,
  );

  const counters = {
    confirmedWorkingStaff,
    availableStaff,
    busyStaff,
    confirmedCapacity: lanes.length,
    queueLength: input.queueLength ?? null,
    walkInEnabled,
    serviceDurationMinutes,
  };

  // 1) Salon closed / inactive -> CLOSED.
  if (!input.isActive || !input.isOpenNow) {
    return finish(input, now, "CLOSED", null, counters);
  }

  // 2) Walk-in / SALO Ticket intake switched off (salon or platform) -> disabled.
  if (!walkInEnabled) {
    return finish(input, now, "WALK_IN_DISABLED", null, counters);
  }

  // 3) Nobody confirmed on duty and no active service -> unconfirmed status.
  if (confirmedWorkingStaff === 0) {
    return finish(input, now, "STAFF_STATUS_UNCONFIRMED", null, counters);
  }

  // 4) Every confirmed worker is busy with an unknown remaining time.
  if (lanes.length === 0) {
    return finish(input, now, "WAIT_UNKNOWN", null, counters);
  }

  // 5) Customers ahead exist but the salon has no configured service duration.
  if (queueAhead >= availableStaff && queueAhead > 0 && serviceDurationMinutes === null) {
    return finish(input, now, "WAIT_UNKNOWN", null, counters);
  }

  // Spare confirmed FREE capacity needs no duration assumption.
  if (queueAhead < availableStaff) return finish(input, now, "AVAILABLE_NOW", 0, counters);

  const pool: Lane[] = lanes.slice();
  for (let served = 0; served < queueAhead; served++) {
    const index = earliestLaneIndex(pool);
    pool[index] = {
      key: pool[index].key,
      availableAt: pool[index].availableAt + (serviceDurationMinutes as number) * 60000,
    };
  }

  const targetAt = pool[earliestLaneIndex(pool)].availableAt;
  const deltaMs = targetAt - now;

  if (deltaMs <= 0) {
    return finish(input, now, "AVAILABLE_NOW", 0, counters);
  }

  return finish(input, now, "ESTIMATED_WAIT", roundWaitMinutes(deltaMs), counters);
}

/** Public projection: only aggregate operational fields ever leave the backend. */
export function projectSmartWaitForPublic(wait: SmartWaitResult) {
  return {
    salonId: wait.salonId,
    state: wait.state,
    reliable: wait.reliable,
    etaMinutes: wait.etaMinutes,
    queueAhead: wait.queueAhead,
    queueLength: wait.queueLength,
    confirmedWorkingStaff: wait.confirmedWorkingStaff,
    availableStaff: wait.availableStaff,
    busyStaff: wait.busyStaff,
    walkInEnabled: wait.walkInEnabled,
    serviceDurationMinutes: wait.serviceDurationMinutes,
    calculatedAt: wait.calculatedAt,
  };
}
