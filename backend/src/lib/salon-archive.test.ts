import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SALON_ARCHIVE_PAYLOAD_VERSION,
  SALON_ARCHIVE_VERSION,
  buildSalonArchiveState,
} from "./salon-archive.js";

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