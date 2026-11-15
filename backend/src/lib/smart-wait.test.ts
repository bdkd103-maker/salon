import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeSmartWait,
  resolveRepresentativeServiceDuration,
  roundWaitMinutes,
  type SmartWaitInput,
  type SmartWaitStaffInput,
} from "./smart-wait.js";
import { buildSmartWaitStaff } from "./smart-wait-data.js";

const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const MINUTE = 60_000;

function free(staffMembershipId: string): SmartWaitStaffInput {
  return {
    staffMembershipId,
    presenceState: "ON_DUTY_CONFIRMED",
    occupancy: "AVAILABLE",
    activeVisitStartedAt: null,
    activeVisitDurationMinutes: null,
  };
}

function busyKnown(staffMembershipId: string, startedAt: number, durationMin: number): SmartWaitStaffInput {
  return {
    staffMembershipId,
    presenceState: "ON_DUTY_CONFIRMED",
    occupancy: "BUSY",
    activeVisitStartedAt: startedAt,
    activeVisitDurationMinutes: durationMin,
  };
}

function busyUnknown(staffMembershipId: string, startedAt: number): SmartWaitStaffInput {
  return {
    staffMembershipId,
    presenceState: "ON_DUTY_CONFIRMED",
    occupancy: "BUSY",
    activeVisitStartedAt: startedAt,
    activeVisitDurationMinutes: null,
  };
}

function unconfirmed(staffMembershipId: string, presenceState: "STALE" | "OFF_DUTY"): SmartWaitStaffInput {
  return {
    staffMembershipId,
    presenceState,
    occupancy: "NOT_AVAILABLE",
    activeVisitStartedAt: null,
    activeVisitDurationMinutes: null,
  };
}

function input(overrides: Partial<SmartWaitInput> = {}): SmartWaitInput {
  return {
    salonId: "salon-1",
    now: NOW,
    isActive: true,
    isOpenNow: true,
    walkInIntakeEnabled: true,
    saloTicketIntakeEnabled: true,
    walkInGloballyEnabled: true,
    saloTicketGloballyEnabled: true,
    representativeServiceDurationMinutes: 30,
    staff: [],
    queueAhead: 0,
    queueLength: 0,
    ...overrides,
  };
}

test("CASE 1: one confirmed FREE staff and nobody ahead -> AVAILABLE_NOW", () => {
  const result = computeSmartWait(input({ staff: [free("mem-1")] }));
  assert.equal(result.state, "AVAILABLE_NOW");
  assert.equal(result.reliable, true);
  assert.equal(result.etaMinutes, 0);
  assert.equal(result.confirmedWorkingStaff, 1);
  assert.equal(result.availableStaff, 1);
  assert.equal(result.confirmedCapacity, 1);
});

test("CASE 2: one confirmed FREE staff and one customer ahead with known duration -> calculated wait", () => {
  const result = computeSmartWait(input({ staff: [free("mem-1")], queueAhead: 1 }));
  assert.equal(result.state, "ESTIMATED_WAIT");
  assert.equal(result.etaMinutes, 30);
  assert.equal(result.queueAhead, 1);
});

test("CASE 3: two confirmed FREE staff and one customer ahead -> parallel capacity keeps target available now", () => {
  const result = computeSmartWait(input({ staff: [free("mem-1"), free("mem-2")], queueAhead: 1 }));
  assert.equal(result.state, "AVAILABLE_NOW");
  assert.equal(result.etaMinutes, 0);
  assert.equal(result.confirmedCapacity, 2);
  assert.equal(result.availableStaff, 2);
});

test("CASE 4: two confirmed FREE staff and two customers ahead -> multi-server allocation", () => {
  const result = computeSmartWait(input({ staff: [free("mem-1"), free("mem-2")], queueAhead: 2 }));
  assert.equal(result.state, "ESTIMATED_WAIT");
  // Both ahead customers take the two free lanes; the target waits for the
  // earliest lane to become free again (one configured service duration).
  assert.equal(result.etaMinutes, 30);
});

test("CASE 5: one FREE plus one BUSY with known remaining -> earliest lane wins", () => {
  // BUSY member started 10 minutes ago with a real 30 minute service -> free in 20.
  const staff = [free("mem-free"), busyKnown("mem-busy", NOW - 10 * MINUTE, 30)];
  const idle = computeSmartWait(input({ staff }));
  assert.equal(idle.state, "AVAILABLE_NOW");

  const withAhead = computeSmartWait(input({ staff, queueAhead: 1 }));
  assert.equal(withAhead.state, "ESTIMATED_WAIT");
  // The FREE lane absorbs the customer ahead; the target starts on the BUSY lane
  // that becomes free first (20 minutes), not on the FREE lane at 30 minutes.
  assert.equal(withAhead.etaMinutes, 20);
});

test("CASE 6: all staff BUSY with known remaining -> correct earliest lane calculation", () => {
  const staff = [
    busyKnown("mem-a", NOW - 25 * MINUTE, 30), // free in 5
    busyKnown("mem-b", NOW - 10 * MINUTE, 30), // free in 20
  ];
  const idle = computeSmartWait(input({ staff }));
  assert.equal(idle.state, "ESTIMATED_WAIT");
  assert.equal(idle.etaMinutes, 5);

  const withAhead = computeSmartWait(input({ staff, queueAhead: 1 }));
  assert.equal(withAhead.state, "ESTIMATED_WAIT");
  // The ahead customer takes the lane free in 5, the target takes the one free in 20.
  assert.equal(withAhead.etaMinutes, 20);
  assert.equal(withAhead.availableStaff, 0);
  assert.equal(withAhead.busyStaff, 2);
});

test("CASE 7: BUSY remaining unknown -> no fabricated precision", () => {
  const unknownOnly = computeSmartWait(input({ staff: [busyUnknown("mem-1", NOW - 5 * MINUTE)] }));
  assert.equal(unknownOnly.state, "WAIT_UNKNOWN");
  assert.equal(unknownOnly.etaMinutes, null);
  assert.equal(unknownOnly.reliable, false);
  assert.equal(unknownOnly.confirmedWorkingStaff, 1);
  assert.equal(unknownOnly.confirmedCapacity, 0);

  // A free confirmed staff member still allows a valid ETA while another busy
  // staff member has unknown remaining time - when the queue allows it.
  const freePlusUnknown = computeSmartWait(input({
    staff: [free("mem-free"), busyUnknown("mem-busy", NOW - 5 * MINUTE)],
  }));
  assert.equal(freePlusUnknown.state, "AVAILABLE_NOW");
  assert.equal(freePlusUnknown.etaMinutes, 0);
  assert.equal(freePlusUnknown.confirmedCapacity, 1);

  // The unknown lane is never used for the calculation, so the estimate is
  // derived only from the confirmed free lane: a conservative upper bound.
  const withAhead = computeSmartWait(input({
    staff: [free("mem-free"), busyUnknown("mem-busy", NOW - 5 * MINUTE)],
    queueAhead: 1,
  }));
  assert.equal(withAhead.state, "ESTIMATED_WAIT");
  assert.equal(withAhead.etaMinutes, 30);
  assert.equal(withAhead.busyStaff, 1);
});

test("CASE 8: stale StaffPresence is excluded from usable capacity", () => {
  const staleOnly = computeSmartWait(input({ staff: [unconfirmed("mem-1", "STALE")] }));
  assert.equal(staleOnly.state, "STAFF_STATUS_UNCONFIRMED");
  assert.equal(staleOnly.availableStaff, 0);
  assert.equal(staleOnly.confirmedCapacity, 0);

  const freePlusStale = computeSmartWait(input({
    staff: [free("mem-free"), unconfirmed("mem-stale", "STALE")],
    queueAhead: 1,
  }));
  assert.equal(freePlusStale.availableStaff, 1);
  assert.equal(freePlusStale.confirmedWorkingStaff, 1);
  assert.equal(freePlusStale.confirmedCapacity, 1);
  // Only one usable lane exists, so the customer ahead occupies it and the
  // target has to wait one configured service duration.
  assert.equal(freePlusStale.state, "ESTIMATED_WAIT");
  assert.equal(freePlusStale.etaMinutes, 30);
});

test("CASE 9: off-duty staff is excluded from usable capacity", () => {
  const offDutyOnly = computeSmartWait(input({ staff: [unconfirmed("mem-1", "OFF_DUTY")] }));
  assert.equal(offDutyOnly.state, "STAFF_STATUS_UNCONFIRMED");
  assert.equal(offDutyOnly.availableStaff, 0);

  const freePlusOffDuty = computeSmartWait(input({
    staff: [free("mem-free"), unconfirmed("mem-off", "OFF_DUTY")],
    queueAhead: 1,
  }));
  assert.equal(freePlusOffDuty.confirmedWorkingStaff, 1);
  assert.equal(freePlusOffDuty.confirmedCapacity, 1);
  assert.equal(freePlusOffDuty.state, "ESTIMATED_WAIT");
  assert.equal(freePlusOffDuty.etaMinutes, 30);
});

test("CASE 10: queue cancellation lowers and recalculates the wait", () => {
  const staff = [free("mem-1")];
  const before = computeSmartWait(input({ staff, queueAhead: 2 }));
  assert.equal(before.state, "ESTIMATED_WAIT");
  assert.equal(before.etaMinutes, 60);

  const afterCancel = computeSmartWait(input({ staff, queueAhead: 1 }));
  assert.equal(afterCancel.state, "ESTIMATED_WAIT");
  assert.equal(afterCancel.etaMinutes, 30);
  assert.ok(afterCancel.etaMinutes! < before.etaMinutes!);
});

test("CASE 11: owner starts the next customer -> queue and ETA recalculate", () => {
  const twoFree = [free("mem-1"), free("mem-2")];
  const before = computeSmartWait(input({ staff: twoFree, queueAhead: 3 }));
  assert.equal(before.state, "ESTIMATED_WAIT");
  assert.equal(before.etaMinutes, 30);
  assert.equal(before.availableStaff, 2);

  // Owner starts the first customer on mem-1 with a WALK_IN ServiceVisit that
  // carries no service assignment -> remaining time is unknown, not invented.
  const afterStart = computeSmartWait(input({
    staff: [busyUnknown("mem-1", NOW), free("mem-2")],
    queueAhead: 2,
  }));
  assert.equal(afterStart.availableStaff, 1);
  assert.equal(afterStart.busyStaff, 1);
  assert.equal(afterStart.confirmedCapacity, 1);
  assert.equal(afterStart.state, "ESTIMATED_WAIT");
  assert.equal(afterStart.etaMinutes, 60);
});

test("CASE 12: service completion frees staff -> ETA recalculates", () => {
  const midService = computeSmartWait(input({
    staff: [busyUnknown("mem-1", NOW), free("mem-2")],
    queueAhead: 2,
  }));
  assert.equal(midService.etaMinutes, 60);

  const completed = computeSmartWait(input({
    staff: [free("mem-1"), free("mem-2")],
    queueAhead: 2,
  }));
  assert.equal(completed.state, "ESTIMATED_WAIT");
  assert.equal(completed.etaMinutes, 30);
  assert.equal(completed.availableStaff, 2);
  assert.ok(completed.etaMinutes! < midService.etaMinutes!);
});

test("CASE 13: SALO Ticket / walk-in intake disabled -> WALK_IN_DISABLED", () => {
  const salonOff = computeSmartWait(input({ staff: [free("mem-1")], saloTicketIntakeEnabled: false }));
  assert.equal(salonOff.state, "WALK_IN_DISABLED");
  assert.equal(salonOff.etaMinutes, null);
  assert.equal(salonOff.reliable, false);

  const walkInOff = computeSmartWait(input({ staff: [free("mem-1")], walkInIntakeEnabled: false }));
  assert.equal(walkInOff.state, "WALK_IN_DISABLED");

  const platformOff = computeSmartWait(input({ staff: [free("mem-1")], walkInGloballyEnabled: false }));
  assert.equal(platformOff.state, "WALK_IN_DISABLED");

  const ticketPlatformOff = computeSmartWait(input({ staff: [free("mem-1")], saloTicketGloballyEnabled: false }));
  assert.equal(ticketPlatformOff.state, "WALK_IN_DISABLED");
});

test("CASE 14: salon closed -> CLOSED", () => {
  const outsideHours = computeSmartWait(input({ staff: [free("mem-1")], isOpenNow: false }));
  assert.equal(outsideHours.state, "CLOSED");
  assert.equal(outsideHours.etaMinutes, null);

  const inactive = computeSmartWait(input({ staff: [free("mem-1")], isActive: false }));
  assert.equal(inactive.state, "CLOSED");
  assert.equal(inactive.etaMinutes, null);
});

test("CASE 15: cross-salon staff never influences the calculation", () => {
  const foreign = [
    { id: "mem-foreign", salonId: "salon-2", status: "ACTIVE", revokedAt: null, presence: null, serviceVisits: [] },
  ];
  const staff = buildSmartWaitStaff(foreign as any, "salon-1", NOW);
  assert.deepEqual(staff, []);

  const result = computeSmartWait(input({ staff }));
  assert.equal(result.state, "STAFF_STATUS_UNCONFIRMED");
  assert.equal(result.confirmedWorkingStaff, 0);

  const own = [
    { id: "mem-own", salonId: "salon-1", status: "ACTIVE", revokedAt: null, presence: null, serviceVisits: [] },
    ...foreign,
  ];
  assert.equal(buildSmartWaitStaff(own as any, "salon-1", NOW).length, 1);
});

test("rounding rule: nearest 5 minutes, never below 5, never a fake zero", () => {
  assert.equal(roundWaitMinutes(0), 0);
  assert.equal(roundWaitMinutes(-1000), 0);
  assert.equal(roundWaitMinutes(13 * MINUTE), 15);
  assert.equal(roundWaitMinutes(12 * MINUTE), 10);
  assert.equal(roundWaitMinutes(1 * MINUTE), 5);
  assert.equal(roundWaitMinutes(90_000), 5);
  assert.equal(roundWaitMinutes(30 * MINUTE), 30);
  assert.equal(roundWaitMinutes(32 * MINUTE), 30);
  assert.equal(roundWaitMinutes(33 * MINUTE), 35);
  assert.equal(roundWaitMinutes(59 * MINUTE), 60);
});

test("representative service duration is the lower median of real configured values", () => {
  assert.equal(resolveRepresentativeServiceDuration([]), null);
  assert.equal(resolveRepresentativeServiceDuration([45]), 45);
  assert.equal(resolveRepresentativeServiceDuration([15, 45]), 15);
  assert.equal(resolveRepresentativeServiceDuration([15, 30, 60]), 30);
  assert.equal(resolveRepresentativeServiceDuration([0, -5, 30, 45]), 30);
  assert.equal(resolveRepresentativeServiceDuration([60, 30, 15]), 30);
});

test("no configured service duration -> queued work duration is unknown, no ETA is invented", () => {
  const result = computeSmartWait(input({
    staff: [free("mem-1")],
    representativeServiceDurationMinutes: null,
    queueAhead: 2,
  }));
  assert.equal(result.state, "WAIT_UNKNOWN");
  assert.equal(result.etaMinutes, null);
  assert.equal(result.serviceDurationMinutes, null);

  // Zero customers ahead still works from real free capacity alone.
  const idle = computeSmartWait(input({
    staff: [free("mem-1")],
    representativeServiceDurationMinutes: null,
    queueAhead: 0,
  }));
  assert.equal(idle.state, "AVAILABLE_NOW");
});

test("duration never marks a busy staff member as available", () => {
  const elapsedVisit = computeSmartWait(input({
    staff: [busyKnown("mem-1", NOW - 120 * MINUTE, 30)],
  }));
  // The lane projects as free again, but occupancy stays BUSY: real SMART
  // operational state remains authoritative.
  assert.equal(elapsedVisit.state, "WAIT_UNKNOWN");
  assert.equal(elapsedVisit.etaMinutes, null);
  assert.equal(elapsedVisit.availableStaff, 0);
  assert.equal(elapsedVisit.busyStaff, 1);
  assert.equal(elapsedVisit.confirmedWorkingStaff, 1);
});

test("staff without a valid salon membership row is never used as capacity", () => {
  const memberships = [
    { id: "mem-revoked", salonId: "salon-1", status: "REVOKED", revokedAt: new Date(), presence: null, serviceVisits: [] },
    { id: "mem-ok", salonId: "salon-1", status: "ACTIVE", revokedAt: null, presence: null, serviceVisits: [] },
  ];
  const staff = buildSmartWaitStaff(memberships as any, "salon-1", NOW);
  assert.equal(staff.length, 1);
  assert.equal(staff[0].staffMembershipId, "mem-ok");
  assert.equal(staff[0].presenceState, "OFF_DUTY");
  assert.equal(staff[0].occupancy, "NOT_AVAILABLE");
});

for (const presenceState of ['STALE','OFF_DUTY'] as const) test(`busy ${presenceState} staff cannot provide an ETA lane`,()=>{
 const r=computeSmartWait(input({staff:[{...busyKnown('busy',NOW-10*MINUTE,30),presenceState}]}));
 assert.equal(r.state,'STAFF_STATUS_UNCONFIRMED');assert.equal(r.etaMinutes,null);assert.equal(r.confirmedCapacity,0);
});
test('future visit timestamps and exactly elapsed durations cannot imply available capacity',()=>{
 for(const started of [NOW+MINUTE,NOW-30*MINUTE]) {const r=computeSmartWait(input({staff:[busyKnown('busy',started,30)]}));assert.equal(r.state,'WAIT_UNKNOWN');assert.equal(r.etaMinutes,null);}
});
test('spare free lane with one ahead does not need a service duration',()=>{
 assert.equal(computeSmartWait(input({staff:[free('a'),free('b')],queueAhead:1,representativeServiceDurationMinutes:null})).state,'AVAILABLE_NOW');
});
