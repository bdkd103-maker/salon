import assert from "node:assert/strict";
const additionalCategories = [
  [
    "barbers",
    "BARBER",
    "barberContent",
    {
      "id": "row-a",
      "salonId": "target",
      "name": "Original",
      "specialty": "Cut",
      "isActive": true
    },
    {
      "name": "Changed",
      "specialty": "Color",
      "isActive": false
    }
  ],
  [
    "reviews",
    "REVIEW",
    "reviewContent",
    {
      "id": "row-a",
      "salonId": "target",
      "userId": "customer-a",
      "rating": 4,
      "comment": "Original",
      "createdAt": "2026-01-01T00:00:00.000Z"
    },
    {
      "userId": "customer-b",
      "rating": 2,
      "comment": "Changed",
      "createdAt": "2026-02-01T00:00:00.000Z"
    }
  ],
  [
    "salonMedia",
    "SALON_MEDIA",
    "salonMediaContent",
    {
      "id": "row-a",
      "salonId": "target",
      "kind": "image",
      "url": "/original.jpg",
      "createdAt": "2026-01-01T00:00:00.000Z"
    },
    {
      "kind": "video",
      "url": "/changed.jpg",
      "createdAt": "2026-02-01T00:00:00.000Z"
    }
  ]
] as const;

for (const [inputKey, category, contentKey, row, changes] of additionalCategories) {
  const base = { salonId: "target", bookingIds: [], serviceVisitIds: [], salonBoostIds: [] };
  const build = (rows: Array<Record<string, unknown>>) =>
    buildSalonArchiveState({ ...base, [inputKey]: rows });
  test(`${category} detects meaningful content changes with unchanged IDs`, () => {
    const before = build([row]);
    for (const [field, value] of Object.entries(changes)) {
      const after = build([{ ...row, [field]: value }]);
      assert.notDeepEqual(after.sourceState, before.sourceState, `${category} must detect changed ${field}`);
      assert.deepEqual(after.coverage, before.coverage);
    }
  });
  test(`${category} canonicalizes ordering and duplicates and reports coverage`, () => {
    const second = { ...row, id: "row-b" };
    const reordered = Object.fromEntries(Object.entries(row).reverse());
    const expected = build([row, second]);
    assert.deepEqual(build([second, reordered, row, second]), expected);
    assert.ok(expected.coverage.categories.includes(category));
    assert.equal(Reflect.get(expected.coverage.counts, inputKey), 2);
    assert.equal(expected.coverage.emptyHistory, false);
    assert.equal(Reflect.get(expected.sourceState, contentKey).length, 2);
    assert.notDeepEqual(build([row, { ...row, ...changes }]).sourceState, build([row]).sourceState,
      "conflicting same-ID content must not be silently discarded");
  });
  test(`${category} distinguishes evaluated empty records from omitted coverage`, () => {
    const empty = build([]);
    const omitted = buildSalonArchiveState(base);
    assert.ok(empty.coverage.categories.includes(category));
    assert.equal(omitted.coverage.categories.includes(category), false);
    assert.equal(Reflect.get(empty.coverage.counts, inputKey), 0);
    assert.deepEqual(Reflect.get(empty.sourceState, contentKey), []);
    assert.equal(empty.coverage.emptyHistory, true);
  });
}
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
