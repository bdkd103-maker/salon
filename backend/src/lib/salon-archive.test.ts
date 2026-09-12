import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SALON_ARCHIVE_PAYLOAD_VERSION,
  SALON_ARCHIVE_VERSION,
  buildSalonArchiveState,
} from "./salon-archive.js";

test("salon archive source state changes when Booking content changes with the same ID", () => {
  // Specify the required content-aware public contract alongside the current ID inputs.
  const input = {
    salonId: "target",
    bookingIds: ["booking-a"],
    serviceVisitIds: [],
    salonBoostIds: [],
    bookings: [{ id: "booking-a", salonId: "target", status: "CONFIRMED" }],
  };
  const changedInput = {
    ...input,
    bookings: [{ ...input.bookings[0], status: "COMPLETED" }],
  };

  const before = buildSalonArchiveState(input);
  const after = buildSalonArchiveState(changedInput);

  assert.deepEqual(after.coverage, before.coverage, "record counts and coverage must remain unchanged");
  assert.notDeepEqual(
    after.sourceState,
    before.sourceState,
    "Booking status changed with identical salon/record IDs; integrity source state must change",
  );
});

test("salon archive state is deterministic and versioned", () => {
  const state = buildSalonArchiveState({
    salonId: "target",
    bookingIds: ["booking-b", "booking-a", "booking-a"],
    serviceVisitIds: ["visit-b", "visit-a"],
    salonBoostIds: ["boost-a"],
  });

  assert.equal(state.archiveVersion, SALON_ARCHIVE_VERSION);
  assert.equal(state.payloadVersion, SALON_ARCHIVE_PAYLOAD_VERSION);

  assert.deepEqual(state.sourceState, {
    salonId: "target",
    bookingIds: ["booking-a", "booking-b"],
    serviceVisitIds: ["visit-a", "visit-b"],
    salonBoostIds: ["boost-a"],
  });

  assert.deepEqual(state.coverage.counts, {
    bookings: 2,
    serviceVisits: 2,
    salonBoosts: 1,
  });

  assert.equal(state.coverage.emptyHistory, false);
});

test("salon archive explicitly records empty evaluated history", () => {
  const state = buildSalonArchiveState({
    salonId: "no-history",
    bookingIds: [],
    serviceVisitIds: [],
    salonBoostIds: [],
  });

  assert.equal(state.coverage.emptyHistory, true);

  assert.deepEqual(state.coverage.counts, {
    bookings: 0,
    serviceVisits: 0,
    salonBoosts: 0,
  });

  assert.deepEqual(state.coverage.categories, [
    "BOOKING",
    "SERVICE_VISIT",
    "SALON_BOOST",
  ]);

  assert.deepEqual(state.sourceState, {
    salonId: "no-history",
    bookingIds: [],
    serviceVisitIds: [],
    salonBoostIds: [],
  });
});
test("salon archive source state changes when ServiceVisit content changes with the same ID", () => {
  const first = buildSalonArchiveState({
    salonId: "salon-1",
    bookingIds: [],
    serviceVisitIds: ["visit-1"],
    salonBoostIds: [],
    serviceVisits: [
      {
        id: "visit-1",
        salonId: "salon-1",
        status: "IN_SERVICE",
      },
    ],
  });

  const second = buildSalonArchiveState({
    salonId: "salon-1",
    bookingIds: [],
    serviceVisitIds: ["visit-1"],
    salonBoostIds: [],
    serviceVisits: [
      {
        id: "visit-1",
        salonId: "salon-1",
        status: "COMPLETED",
      },
    ],
  });

  assert.notDeepEqual(first.sourceState, second.sourceState);
});
test("salon archive source state changes when SalonBoost content changes with the same ID", () => {
  const first = buildSalonArchiveState({
    salonId: "salon-1",
    bookingIds: [],
    serviceVisitIds: [],
    salonBoostIds: ["boost-1"],
    salonBoosts: [
      {
        id: "boost-1",
        salonId: "salon-1",
        status: "ACTIVE",
      },
    ],
  });

  const second = buildSalonArchiveState({
    salonId: "salon-1",
    bookingIds: [],
    serviceVisitIds: [],
    salonBoostIds: ["boost-1"],
    salonBoosts: [
      {
        id: "boost-1",
        salonId: "salon-1",
        status: "EXPIRED",
      },
    ],
  });

  assert.notDeepEqual(first.sourceState, second.sourceState);
});