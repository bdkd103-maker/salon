import assert from "node:assert/strict";
test("loyalty child history is canonical, content-aware and card-scoped", () => {
  const card = nextCategories[1][4];
  const customer = { id: "c", cardId: "a", customerId: "u", currentStamps: 2, totalVisits: 3, lastStampedAt: null, rewardRedeemedAt: null, createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-01-01T10:00:00Z" };
  const stamp = { id: "s", cardId: "a", customerId: "u", barberId: null, transactionId: "tx", stampAt: "2026-01-01T10:00:00Z", isValid: true, verificationToken: null, createdAt: "2026-01-01T10:00:00Z" };
  const base = { salonId: "target", bookingIds: [], serviceVisitIds: [], salonBoostIds: [] };
  const build = (customers: object[], stamps: object[]) => buildSalonArchiveState({ ...base, loyalty: [{ ...card, customers, stamps }] });
  const before = build([customer], [stamp]);
  assert.deepEqual(build([customer, customer], [stamp, stamp]), before);
  assert.notDeepEqual(build([{ ...customer, currentStamps: 3 }], [stamp]).sourceState, before.sourceState);
  assert.notDeepEqual(build([customer], [{ ...stamp, isValid: false }]).sourceState, before.sourceState);
  assert.deepEqual(build([customer], [{ ...stamp, stampAt: new Date(stamp.stampAt) }]), before);
  const conflict = { ...stamp, isValid: false };
  assert.deepEqual(build([customer], [stamp, conflict]), build([customer], [conflict, stamp, conflict]));
  assert.notDeepEqual(build([customer], [stamp, conflict]).sourceState, before.sourceState);
  assert.throws(() => build([{ ...customer, cardId: "other" }], [stamp]), /card/i);
  assert.throws(() => build([customer], [{ ...stamp, cardId: "other" }]), /card/i);
});
const nextCategories = [
  [
    "queueEntries",
    "QUEUE_ENTRY",
    "queueEntryContent",
    "id",
    {
      "id": "a",
      "salonId": "target",
      "customerId": null,
      "serviceVisitId": null,
      "source": "MANUAL_WALK_IN",
      "status": "WAITING",
      "joinedAt": "2026-01-01T10:00:00Z",
      "calledAt": null,
      "startedAt": null,
      "cancelledAt": null,
      "expiredAt": null,
      "noShowAt": null,
      "version": 1
    },
    {
      "status": "CALLED",
      "version": 2,
      "customerId": "u",
      "serviceVisitId": "v",
      "source": "SALO_TICKET",
      "joinedAt": "2026-02-01T10:00:00Z",
      "calledAt": "2026-01-01T10:00:00Z",
      "startedAt": "2026-01-01T10:00:00Z",
      "cancelledAt": "2026-01-01T10:00:00Z",
      "expiredAt": "2026-01-01T10:00:00Z",
      "noShowAt": "2026-01-01T10:00:00Z"
    }
  ],
  [
    "loyalty",
    "LOYALTY",
    "loyaltyContent",
    "id",
    {
      "id": "a",
      "salonId": "target",
      "isActive": true,
      "requiredStamps": 8,
      "rewardType": "FREE_SERVICE",
      "rewardTitle": "Reward",
      "rewardText": "Free cut",
      "description": null,
      "createdAt": "2026-01-01T10:00:00Z",
      "updatedAt": "2026-01-01T10:00:00Z",
      "customers": [],
      "stamps": []
    },
    {
      "isActive": false,
      "requiredStamps": 9,
      "rewardType": "FIXED_DISCOUNT",
      "rewardTitle": "New",
      "rewardText": "New text",
      "description": "Description",
      "createdAt": "2026-02-01T10:00:00Z"
    }
  ],
  [
    "offers",
    "OFFER",
    "offerContent",
    "id",
    {
      "id": "a",
      "salonId": "target",
      "title": "Offer",
      "description": null,
      "price": "12.30",
      "isActive": true,
      "availableSlots": 3,
      "discount": null,
      "endAt": null,
      "endTime": null,
      "serviceName": null,
      "startAt": "2026-01-01T10:00:00Z",
      "startTime": "10:00"
    },
    {
      "title": "New",
      "description": "New",
      "price": "12.31",
      "isActive": false,
      "availableSlots": 2,
      "discount": "1.20",
      "endAt": "2026-01-01T10:00:00Z",
      "endTime": "11:00",
      "serviceName": "Cut",
      "startAt": "2026-02-01T10:00:00Z",
      "startTime": "10:30"
    }
  ],
  [
    "analyticsEvents",
    "ANALYTICS_EVENT",
    "analyticsEventContent",
    "id",
    {
      "id": "a",
      "salonId": "target",
      "userId": null,
      "eventType": "VIEW",
      "source": "app",
      "metadata": {
        "b": [
          1,
          2
        ],
        "a": {
          "x": true
        }
      },
      "createdAt": "2026-01-01T10:00:00Z"
    },
    {
      "userId": "u",
      "eventType": "CLICK",
      "source": "web",
      "metadata": {
        "a": {
          "x": false
        },
        "b": [
          1,
          2
        ]
      },
      "createdAt": "2026-02-01T10:00:00Z"
    }
  ],
  [
    "liveStatus",
    "LIVE_STATUS",
    "liveStatusContent",
    "salonId",
    {
      "salonId": "target",
      "operationalState": "OPEN",
      "observedAt": "2026-01-01T10:00:00Z",
      "expiresAt": null,
      "source": "manual"
    },
    {
      "operationalState": "CLOSED",
      "observedAt": "2026-02-01T10:00:00Z",
      "expiresAt": "2026-01-01T10:00:00Z",
      "source": "system"
    }
  ],
  [
    "availabilitySubscriptions",
    "AVAILABILITY_SUBSCRIPTION",
    "availabilitySubscriptionContent",
    "id",
    {
      "id": "a",
      "salonId": "target",
      "userId": "u",
      "status": "ACTIVE",
      "lastKnownAvailableChairs": 0,
      "lastNotifiedAt": null,
      "createdAt": "2026-01-01T10:00:00Z"
    },
    {
      "userId": "v",
      "status": "FIRED",
      "lastKnownAvailableChairs": 1,
      "lastNotifiedAt": "2026-01-01T10:00:00Z",
      "createdAt": "2026-02-01T10:00:00Z"
    }
  ]
] as const;
for (const [key, category, contentKey, identity, row, changes] of nextCategories) {
  const base = { salonId: "target", bookingIds: [], serviceVisitIds: [], salonBoostIds: [] };
  const build = (rows: Array<Record<string, unknown>>) => buildSalonArchiveState({ ...base, [key]: rows });
  test(`${category} detects each meaningful field change`, () => {
    for (const [field, value] of Object.entries(changes))
      assert.notDeepEqual(build([{ ...row, [field]: value }]).sourceState, build([row]).sourceState, field);
  });
  test(`${category} canonicalizes duplicates and preserves conflicting identities`, () => {
    const conflict = { ...row, ...changes };
    const mixed = build([row, conflict]);
    assert.deepEqual(build([conflict, Object.fromEntries(Object.entries(row).reverse()), row]), mixed);
    assert.equal(Reflect.get(mixed.sourceState, contentKey).length, 2);
    assert.equal(Reflect.get(mixed.coverage.counts, key), 1);
    assert.equal(mixed.coverage.emptyHistory, false);
    if (identity === "id") assert.equal(Reflect.get(build([row, { ...row, id: "b" }]).coverage.counts, key), 2);
  });
  test(`${category} distinguishes omitted from evaluated empty`, () => {
    const omitted = buildSalonArchiveState(base);
    const empty = build([]);
    assert.equal(omitted.coverage.categories.includes(category), false);
    assert.equal(Reflect.has(omitted.coverage.counts, key), false);
    assert.equal(Reflect.has(omitted.sourceState, contentKey), false);
    assert.ok(empty.coverage.categories.includes(category));
    assert.equal(Reflect.get(empty.coverage.counts, key), 0);
    assert.deepEqual(Reflect.get(empty.sourceState, contentKey), []);
    assert.equal(empty.coverage.emptyHistory, true);
  });
  test(`${category} normalizes Date values to ISO`, () => {
    const values = { ...row, ...changes };
    const dates = Object.fromEntries(Object.entries(values).map(([k, v]) =>
      [k, k.endsWith("At") && typeof v === "string" ? new Date(v) : v]));
    assert.deepEqual(build([dates]), build([values]));
    assert.ok(Reflect.get(build([dates]).sourceState, contentKey)?.[0].includes(".000Z"));
  });
  test(`${category} rejects records from another salon`, () => {
    assert.throws(() => build([{ ...row, salonId: "sibling" }]), /salon/i);
  });
}
test("analytics metadata canonicalizes nested keys without hiding array changes", () => {
  const row = nextCategories[3][4];
  const base = { salonId: "target", bookingIds: [], serviceVisitIds: [], salonBoostIds: [] };
  const build = (metadata: object) => buildSalonArchiveState({ ...base, analyticsEvents: [{ ...row, metadata }] });
  assert.deepEqual(build({ b: [1, 2], a: { x: true } }), build({ a: { x: true }, b: [1, 2] }));
  assert.notDeepEqual(build({ a: { x: true }, b: [2, 1] }).sourceState, build(row.metadata).sourceState);
});
test("offer decimals normalize equivalent exact values and preserve null", () => {
  const row = nextCategories[2][4];
  const base = { salonId: "target", bookingIds: [], serviceVisitIds: [], salonBoostIds: [] };
  const build = (price: string | null) => buildSalonArchiveState({ ...base, offers: [{ ...row, price }] });
  assert.deepEqual(build("12.30"), build("12.300"));
  assert.notDeepEqual(build(null).sourceState, build("0").sourceState);
});
const workforceCategories = [["services","SERVICE","serviceContent","id",{"id":"a","salonId":"target","name":"Cut","description":null,"durationMin":30,"price":"12.30","isActive":true,"createdAt":"2026-01-01T09:00:00Z","updatedAt":"2026-01-01T10:00:00Z"},{"name":"Color","description":"New","durationMin":45,"price":"12.31","isActive":false}],["availability","AVAILABILITY","availabilityContent","id",{"id":"a","salonId":"target","barberId":null,"startAt":"2026-01-01T10:00:00Z","endAt":"2026-01-01T11:00:00Z","status":"AVAILABLE","createdAt":"2026-01-01T09:00:00Z"},{"barberId":"b","startAt":"2026-01-01T10:30:00Z","endAt":"2026-01-01T11:30:00Z","status":"BOOKED"}],["staffMemberships","STAFF_MEMBERSHIP","staffMembershipContent","id",{"id":"a","salonId":"target","userId":"u","barberId":"b","status":"ACTIVE","revokedAt":null},{"userId":"v","barberId":"c","status":"REVOKED","revokedAt":"2026-01-01T10:00:00Z"}],["staffPresence","STAFF_PRESENCE","staffPresenceContent","staffMembershipId",{"staffMembershipId":"a","dutyState":"ON_DUTY","generation":1,"changedAt":"2026-01-01T10:00:00Z","changedByUserId":null,"changeSource":"STAFF"},{"dutyState":"OFF_DUTY","generation":2,"changedAt":"2026-01-01T11:00:00Z","changedByUserId":"u","changeSource":"OWNER"}]] as const;
for (const [key, category, contentKey, identity, row, changes] of workforceCategories) {
  const base = { salonId: "target", bookingIds: [], serviceVisitIds: [], salonBoostIds: [] };
  const build = (rows: Array<Record<string, unknown>>) => buildSalonArchiveState({ ...base, [key]: rows });
  test(`${category} detects each meaningful field change`, () => {
    for (const [field, value] of Object.entries(changes)) {
      assert.notDeepEqual(build([{ ...row, [field]: value }]).sourceState, build([row]).sourceState, field);
    }
  });
  test(`${category} canonicalizes order, duplicates and retains conflicts`, () => {
    const second = { ...row, [identity]: "b" };
    const expected = build([row, second]);
    assert.deepEqual(build([second, Object.fromEntries(Object.entries(row).reverse()), row]), expected);
    assert.equal(Reflect.get(expected.sourceState, contentKey).length, 2);
    assert.equal(Reflect.get(expected.coverage.counts, key), 2);
    assert.equal(expected.coverage.emptyHistory, false);
    const conflict = { ...row, ...changes };
    const mixed = build([row, conflict]);
    assert.equal(Reflect.get(mixed.sourceState, contentKey).length, 2);
    assert.equal(Reflect.get(mixed.coverage.counts, key), 1);
    assert.deepEqual(build([conflict, row, conflict]), mixed);
  });
  test(`${category} distinguishes omitted and evaluated-empty coverage`, () => {
    const omitted = buildSalonArchiveState(base);
    const empty = build([]);
    assert.equal(omitted.coverage.categories.includes(category), false);
    assert.equal(Reflect.has(omitted.coverage.counts, key), false);
    assert.equal(Reflect.has(omitted.sourceState, contentKey), false);
    assert.ok(empty.coverage.categories.includes(category));
    assert.equal(Reflect.get(empty.coverage.counts, key), 0);
    assert.deepEqual(Reflect.get(empty.sourceState, contentKey), []);
    assert.equal(empty.coverage.emptyHistory, true);
  });
  if (key !== "services") {
    test(`${category} canonicalizes Date and equivalent ISO timestamps`, () => {
      const dates = Object.fromEntries(Object.entries({ ...row, ...changes }).map(([field, value]) =>
        [field, field.endsWith("At") && typeof value === "string" ? new Date(value) : value]));
      assert.deepEqual(build([dates]), build([{ ...row, ...changes }]));
      const content = Reflect.get(build([dates]).sourceState, contentKey);
      assert.ok(content[0].includes(".000Z"));
    });
  }
}
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
      "isActive": true,
      "createdAt": "2026-01-01T09:00:00Z",
      "updatedAt": "2026-01-01T10:00:00Z"
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
  buildSalonArchiveState as buildCurrentSalonArchiveState,
  isCurrentSalonArchiveContract,
} from "./salon-archive.js";

// Existing tuple fixtures explicitly exercise the historical V1 contract.
const buildSalonArchiveState = (input: Parameters<typeof buildCurrentSalonArchiveState>[0]) =>
  buildCurrentSalonArchiveState(input, { archiveVersion: 1, payloadVersion: 1 });

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

  assert.equal(state.archiveVersion, 1);
  assert.equal(state.payloadVersion, 1);

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

// Complete current V2 source fixtures; historical V1 fixtures remain explicit.
const v2Booking = {"id": "b", "salonId": "target", "userId": "customer", "barberId": null, "serviceId": null, "startAt": "2026-01-01T00:00:00.000Z", "endAt": "2026-01-01T00:00:00.000Z", "status": "COMPLETED", "notes": null, "customerName": null, "customerPhone": null, "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z", "cancelledAt": null, "cancellationReason": null};
const v2Visit = {"id": "v", "salonId": "target", "bookingId": null, "staffMembershipId": "m", "source": "WALK_IN", "status": "COMPLETED", "startedAt": "2026-01-01T00:00:00.000Z", "completedAt": null, "cancelledAt": null, "version": 1, "startedByUserId": null, "completedByUserId": null, "cancelledByUserId": null, "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z"};
const v2Membership = {"id": "m", "salonId": "target", "userId": "owner", "barberId": "barber", "status": "ACTIVE", "revokedAt": null, "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z"};

const v2Cases = [
  ["bookings", "bookingContent", v2Booking, ["id", "salonId", "status"]],
  ["serviceVisits", "serviceVisitContent", v2Visit, ["id", "salonId", "status"]],
  ["staffMemberships", "staffMembershipContent", v2Membership, ["id", "salonId", "userId", "barberId", "status", "revokedAt"]],
] as const;
// These remain historical V2 tests; current V3 QueueEntry is tested separately.
const buildV2SalonArchiveState = (input: Parameters<typeof buildCurrentSalonArchiveState>[0]) =>
  buildCurrentSalonArchiveState(input, { archiveVersion: 2, payloadVersion: 2 });
for (const [key, content, row, legacyFields] of v2Cases) {
  const input = (rows: object[]) => ({ salonId: "target", bookingIds: key === "bookings" && rows.length ? ["b"] : [], serviceVisitIds: key === "serviceVisits" && rows.length ? ["v"] : [], salonBoostIds: [], [key]: rows });
  test(`V2 ${key} exact persisted field order, nulls and every field's integrity`, () => {
    const before = buildV2SalonArchiveState(input([row]));
    assert.equal(before.archiveVersion, 2);
    assert.equal(before.payloadVersion, 2);
    assert.equal(SALON_ARCHIVE_VERSION, 7);
    assert.equal(SALON_ARCHIVE_PAYLOAD_VERSION, 7);
    assert.deepEqual(JSON.parse(before.sourceState[content]![0]), Object.values(row));
    for (const [field, value] of Object.entries(row)) {
      if (field === "salonId") continue;
      const changed = field.endsWith("At") ? "2026-02-01T00:00:00.000Z" : typeof value === "number" ? 2 : "changed";
      assert.notDeepEqual(buildV2SalonArchiveState(input([{ ...row, [field]: changed }])).sourceState, before.sourceState, field);
    }
  });
  test(`V2 ${key} canonical dates, ordering, duplicates and conflicting identity`, () => {
    const before = buildV2SalonArchiveState(input([row]));
    const dates = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, k.endsWith("At") && v !== null ? new Date(v as string) : v]));
    assert.deepEqual(buildV2SalonArchiveState(input([dates, row])), before);
    const conflict = { ...row, status: "CANCELLED" };
    const state = buildV2SalonArchiveState(input([row, conflict]));
    assert.deepEqual(state, buildV2SalonArchiveState(input([conflict, row, conflict])));
    assert.equal(state.sourceState[content]!.length, 2);
    assert.equal(Object.values(state.coverage.counts).reduce((a, b) => a + b, 0), 1);
  });
  test(`V1 ${key} stays historical and is never expanded or mutated`, () => {
    const oldRow = Object.fromEntries(legacyFields.map(field => [field, row[field]]));
    const source = input([oldRow]);
    const copy = structuredClone(source);
    const old = buildCurrentSalonArchiveState(source, { archiveVersion: 1, payloadVersion: 1 });
    assert.equal(old.archiveVersion, 1);
    assert.equal(old.payloadVersion, 1);
    assert.deepEqual(JSON.parse(old.sourceState[content]![0]), Object.values(oldRow));
    assert.deepEqual(source, copy);
    assert.throws(() => buildV2SalonArchiveState(source), /missing.*V2|V2.*missing/i);
  });
  test(`V2 ${key} evaluated-empty semantics and target scoping`, () => {
    const empty = buildV2SalonArchiveState(input([]));
    assert.equal(empty.coverage.emptyHistory, true);
    assert.deepEqual(empty.sourceState[content], []);
    assert.equal(buildV2SalonArchiveState({ salonId: "target", bookingIds: [], serviceVisitIds: [], salonBoostIds: [] }).sourceState[content], undefined);
    assert.throws(() => buildV2SalonArchiveState(input([{ ...row, salonId: "sibling" }])), /another salon/i);
  });
}
test("archive contract rejects mixed and unsupported versions", () => {
  for (const contract of [{ archiveVersion: 1, payloadVersion: 2 }, { archiveVersion: 2, payloadVersion: 1 }, { archiveVersion: 999, payloadVersion: 2 }, { archiveVersion: 2, payloadVersion: 999 }]) {
    assert.throws(() => buildCurrentSalonArchiveState({ salonId: "target", bookingIds: [], serviceVisitIds: [], salonBoostIds: [] }, contract), /unsupported/i);
  }
});

const v3QueueEntry = {"id": "q", "salonId": "target", "customerId": null, "serviceVisitId": null, "source": "SALO_TICKET", "status": "WAITING", "joinedAt": "2026-01-01T00:00:00.000Z", "calledAt": null, "startedAt": null, "cancelledAt": null, "expiredAt": null, "noShowAt": null, "version": 1, "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z"};
const queueInput = (rows: object[]) => ({ salonId: "target", bookingIds: [], serviceVisitIds: [], salonBoostIds: [], queueEntries: rows });
test("V3 QueueEntry exact field order, chronology, nulls and canonical duplicates", () => {
  const build = (rows: object[]) => buildCurrentSalonArchiveState(queueInput(rows) as Parameters<typeof buildCurrentSalonArchiveState>[0]);
  const before = build([v3QueueEntry]);
  assert.equal(before.archiveVersion, 7);
  assert.equal(before.payloadVersion, 7);
  assert.deepEqual(JSON.parse(before.sourceState.queueEntryContent![0]), Object.values(v3QueueEntry));
  const dates = Object.fromEntries(Object.entries(v3QueueEntry).reverse().map(([k,v]) => [k, k.endsWith("At") && v !== null ? new Date(v as string) : v]));
  assert.deepEqual(build([dates, v3QueueEntry]), before);
  for (const field of ["createdAt", "updatedAt"]) {
    const conflict = { ...v3QueueEntry, [field]: "2026-02-01T00:00:00.000Z" };
    assert.notDeepEqual(build([conflict]).sourceState, before.sourceState);
    const both = build([conflict, v3QueueEntry]);
    assert.deepEqual(both, build([v3QueueEntry, conflict, conflict]));
    assert.equal(both.sourceState.queueEntryContent!.length, 2);
    assert.equal(both.coverage.counts.queueEntries, 1);
  }
  assert.deepEqual(build([]).sourceState.queueEntryContent, []);
  assert.equal(build([]).coverage.counts.queueEntries, 0);
  assert.equal(build([]).coverage.emptyHistory, true);
  assert.ok(build([]).coverage.categories.includes("QUEUE_ENTRY"));
  const omitted = buildCurrentSalonArchiveState({ salonId: "target", bookingIds: [], serviceVisitIds: [], salonBoostIds: [] });
  assert.equal(omitted.sourceState.queueEntryContent, undefined);
  assert.equal(omitted.coverage.categories.includes("QUEUE_ENTRY"), false);
});
for (const version of [1, 2]) {
  test(`V${version} QueueEntry keeps 13 fields and cannot be silently promoted`, () => {
    const { createdAt, updatedAt, ...historicalRow } = v3QueueEntry;
    const input = queueInput([historicalRow]) as Parameters<typeof buildCurrentSalonArchiveState>[0];
    const snapshot = structuredClone(input);
    const historical = buildCurrentSalonArchiveState(input, { archiveVersion: version, payloadVersion: version });
    assert.equal(historical.archiveVersion, version);
    assert.equal(historical.payloadVersion, version);
    assert.deepEqual(JSON.parse(historical.sourceState.queueEntryContent![0]), Object.values(historicalRow));
    assert.deepEqual(input, snapshot);
    assert.throws(() => buildCurrentSalonArchiveState(input), /V3.*chronology|missing.*V3/i);
  });
}

// ── V4 archive contract: StaffPresence + StaffPresenceLease ──

const v4Base = { salonId: "target", bookingIds: [], serviceVisitIds: [], salonBoostIds: [] };

const v4Presence = {
  staffMembershipId: "m1", dutyState: "ON_DUTY", generation: 1,
  changedAt: "2026-01-01T10:00:00Z", changedByUserId: "owner", changeSource: "OWNER",
  createdAt: "2026-01-01T09:00:00Z", updatedAt: "2026-01-01T10:00:00Z",
  leases: [] as Array<Record<string, unknown>>,
};

const v4Lease = {
  id: "lease-1", staffMembershipId: "m1", generation: 1,
  evidenceSource: "DEVICE", producerKey: "key-1",
  observedAt: "2026-01-01T10:00:00Z", validUntil: "2026-01-01T11:00:00Z",
  revokedAt: null as string | null,
  createdAt: "2026-01-01T09:30:00Z", updatedAt: "2026-01-01T10:00:00Z",
};

test("V4 StaffPresence archive evidence includes all 8 persisted fields", () => {
  const state = buildCurrentSalonArchiveState({
    ...v4Base,
    staffPresence: [{ ...v4Presence, leases: [] }],
  });
  const content = state.sourceState.staffPresenceContent!;
  assert.equal(content.length, 1);
  const parsed = JSON.parse(content[0]);
  // V4 tuple: [staffMembershipId, dutyState, generation, changedAt, changedByUserId, changeSource, createdAt, updatedAt, []]
  assert.equal(parsed[0], "m1");
  assert.equal(parsed[1], "ON_DUTY");
  assert.equal(parsed[2], 1);
  assert.equal(parsed[3], "2026-01-01T10:00:00.000Z");
  assert.equal(parsed[4], "owner");
  assert.equal(parsed[5], "OWNER");
  assert.equal(parsed[6], "2026-01-01T09:00:00.000Z");
  assert.equal(parsed[7], "2026-01-01T10:00:00.000Z");
  assert.deepEqual(parsed[8], []);
});

test("V4 StaffPresenceLease evidence includes all 10 persisted fields", () => {
  const state = buildCurrentSalonArchiveState({
    ...v4Base,
    staffPresence: [{ ...v4Presence, leases: [{ ...v4Lease }] }],
  });
  const content = state.sourceState.staffPresenceContent!;
  const parsed = JSON.parse(content[0]);
  const lease = JSON.parse(parsed[8][0]);
  assert.equal(lease[0], "lease-1");
  assert.equal(lease[1], "m1");
  assert.equal(lease[2], 1);
  assert.equal(lease[3], "DEVICE");
  assert.equal(lease[4], "key-1");
  assert.equal(lease[5], "2026-01-01T10:00:00.000Z");
  assert.equal(lease[6], "2026-01-01T11:00:00.000Z");
  assert.equal(lease[7], null);
  assert.equal(lease[8], "2026-01-01T09:30:00.000Z");
  assert.equal(lease[9], "2026-01-01T10:00:00.000Z");
});

test("V4 lease DateTimes are canonicalized and nullable revokedAt is preserved", () => {
  const withDates = buildCurrentSalonArchiveState({
    ...v4Base,
    staffPresence: [{ ...v4Presence, leases: [{ ...v4Lease, observedAt: new Date("2026-01-01T10:00:00Z") }] }],
  });
  const withStrings = buildCurrentSalonArchiveState({
    ...v4Base,
    staffPresence: [{ ...v4Presence, leases: [{ ...v4Lease, observedAt: "2026-01-01T10:00:00Z" }] }],
  });
  assert.deepEqual(withDates, withStrings);
  // revokedAt null is preserved
  const parsed = JSON.parse(withDates.sourceState.staffPresenceContent![0]);
  const lease = JSON.parse(parsed[8][0]);
  assert.equal(lease[7], null);
  // revokedAt with value is canonicalized
  const withRevoked = buildCurrentSalonArchiveState({
    ...v4Base,
    staffPresence: [{ ...v4Presence, leases: [{ ...v4Lease, revokedAt: "2026-01-01T12:00:00Z" }] }],
  });
  const parsedRevoked = JSON.parse(withRevoked.sourceState.staffPresenceContent![0]);
  const leaseRevoked = JSON.parse(parsedRevoked[8][0]);
  assert.equal(leaseRevoked[7], "2026-01-01T12:00:00.000Z");
});

test("V4 leases are scoped through StaffMembership and appear in archive evidence", () => {
  const state = buildCurrentSalonArchiveState({
    ...v4Base,
    staffPresence: [{
      ...v4Presence,
      leases: [
        { ...v4Lease, id: "lease-a" },
        { ...v4Lease, id: "lease-b", evidenceSource: "NETWORK" },
      ],
    }],
  });
  const content = state.sourceState.staffPresenceContent!;
  const parsed = JSON.parse(content[0]);
  assert.equal(parsed[8].length, 2);
  const leaseA = JSON.parse(parsed[8][0]);
  const leaseB = JSON.parse(parsed[8][1]);
  assert.equal(leaseA[0], "lease-a");
  assert.equal(leaseB[0], "lease-b");
  assert.equal(leaseB[3], "NETWORK");
  assert.equal(state.coverage.counts.staffPresenceLease, 2);
});

test("V3 evidence is not current deletion-eligible evidence after V4 bump", () => {
  const v3State = buildCurrentSalonArchiveState(
    { ...v4Base, staffPresence: [{ ...v4Presence, leases: [] }] },
    { archiveVersion: 3, payloadVersion: 3 },
  );
  assert.equal(v3State.archiveVersion, 3);
  assert.equal(v3State.payloadVersion, 3);
  assert.equal(isCurrentSalonArchiveContract(v3State), false);
  // V3 presence tuple has 6 fields (no createdAt/updatedAt, no leases)
  const parsed = JSON.parse(v3State.sourceState.staffPresenceContent![0]);
  assert.equal(parsed.length, 6);
});

// ── V5 archive contract: Barber/Service/AvailabilitySlot evidence completion ──

const v5Base = { salonId: "target", bookingIds: [], serviceVisitIds: [], salonBoostIds: [] };

const v5Barber = {
  id: "barber-1", salonId: "target", name: "Anna", specialty: "Cut",
  isActive: true,
  createdAt: "2026-01-01T09:00:00Z", updatedAt: "2026-01-01T10:00:00Z",
};

const v5Service = {
  id: "service-1", salonId: "target", name: "Cut", description: null,
  durationMin: 30, price: "12.30", isActive: true,
  createdAt: "2026-01-01T09:00:00Z", updatedAt: "2026-01-01T10:00:00Z",
};

const v5Availability = {
  id: "slot-1", salonId: "target", barberId: null,
  startAt: "2026-01-01T10:00:00Z", endAt: "2026-01-01T11:00:00Z",
  status: "AVAILABLE",
  createdAt: "2026-01-01T09:00:00Z",
};

test("V4 is legacy and not current deletion-eligible evidence after V5 bump", () => {
  const v4State = buildCurrentSalonArchiveState(
    { ...v5Base, barbers: [{ ...v5Barber }] },
    { archiveVersion: 4, payloadVersion: 4 },
  );
  assert.equal(v4State.archiveVersion, 4);
  assert.equal(v4State.payloadVersion, 4);
  assert.equal(isCurrentSalonArchiveContract(v4State), false);
  // V4 barber tuple has 5 fields (no createdAt/updatedAt)
  const parsed = JSON.parse(v4State.sourceState.barberContent![0]);
  assert.equal(parsed.length, 5);
});

test("V5 Barber archive evidence includes all 7 persisted fields", () => {
  const state = buildCurrentSalonArchiveState({
    ...v5Base,
    barbers: [{ ...v5Barber }],
  });
  const content = state.sourceState.barberContent!;
  assert.equal(content.length, 1);
  const parsed = JSON.parse(content[0]);
  // V5 tuple: [id, salonId, name, specialty, isActive, createdAt, updatedAt]
  assert.equal(parsed[0], "barber-1");
  assert.equal(parsed[1], "target");
  assert.equal(parsed[2], "Anna");
  assert.equal(parsed[3], "Cut");
  assert.equal(parsed[4], true);
  assert.equal(parsed[5], "2026-01-01T09:00:00.000Z");
  assert.equal(parsed[6], "2026-01-01T10:00:00.000Z");
  assert.equal(parsed.length, 7);
});

test("V5 Service archive evidence includes all 9 persisted fields", () => {
  const state = buildCurrentSalonArchiveState({
    ...v5Base,
    services: [{ ...v5Service }],
  });
  const content = state.sourceState.serviceContent!;
  assert.equal(content.length, 1);
  const parsed = JSON.parse(content[0]);
  // V5 tuple: [id, salonId, name, description, durationMin, price, isActive, createdAt, updatedAt]
  assert.equal(parsed[0], "service-1");
  assert.equal(parsed[1], "target");
  assert.equal(parsed[2], "Cut");
  assert.equal(parsed[3], null);
  assert.equal(parsed[4], 30);
  assert.equal(parsed[5], "12.3");
  assert.equal(parsed[6], true);
  assert.equal(parsed[7], "2026-01-01T09:00:00.000Z");
  assert.equal(parsed[8], "2026-01-01T10:00:00.000Z");
  assert.equal(parsed.length, 9);
});

test("V5 AvailabilitySlot archive evidence includes all 7 persisted fields", () => {
  const state = buildCurrentSalonArchiveState({
    ...v5Base,
    availability: [{ ...v5Availability }],
  });
  const content = state.sourceState.availabilityContent!;
  assert.equal(content.length, 1);
  const parsed = JSON.parse(content[0]);
  // V5 tuple: [id, salonId, barberId, startAt, endAt, status, createdAt]
  assert.equal(parsed[0], "slot-1");
  assert.equal(parsed[1], "target");
  assert.equal(parsed[2], null);
  assert.equal(parsed[3], "2026-01-01T10:00:00.000Z");
  assert.equal(parsed[4], "2026-01-01T11:00:00.000Z");
  assert.equal(parsed[5], "AVAILABLE");
  assert.equal(parsed[6], "2026-01-01T09:00:00.000Z");
  assert.equal(parsed.length, 7);
});

test("V5 barber DateTime fields are canonicalized and nullable specialty is preserved", () => {
  const withDates = buildCurrentSalonArchiveState({
    ...v5Base,
    barbers: [{ ...v5Barber, createdAt: new Date("2026-01-01T09:00:00Z"), updatedAt: new Date("2026-01-01T10:00:00Z") }],
  });
  const withStrings = buildCurrentSalonArchiveState({
    ...v5Base,
    barbers: [{ ...v5Barber }],
  });
  assert.deepEqual(withDates, withStrings);
  const parsed = JSON.parse(withDates.sourceState.barberContent![0]);
  assert.ok(parsed[5].includes(".000Z"));
  assert.ok(parsed[6].includes(".000Z"));
  // nullable specialty preserved
  const withNull = buildCurrentSalonArchiveState({
    ...v5Base,
    barbers: [{ ...v5Barber, specialty: null }],
  });
  const parsedNull = JSON.parse(withNull.sourceState.barberContent![0]);
  assert.equal(parsedNull[3], null);
});

test("V5 service DateTime fields are canonicalized", () => {
  const withDates = buildCurrentSalonArchiveState({
    ...v5Base,
    services: [{ ...v5Service, createdAt: new Date("2026-01-01T09:00:00Z"), updatedAt: new Date("2026-01-01T10:00:00Z") }],
  });
  const withStrings = buildCurrentSalonArchiveState({
    ...v5Base,
    services: [{ ...v5Service }],
  });
  assert.deepEqual(withDates, withStrings);
  const parsed = JSON.parse(withDates.sourceState.serviceContent![0]);
  assert.ok(parsed[7].includes(".000Z"));
  assert.ok(parsed[8].includes(".000Z"));
});

test("V5 availability DateTime fields are canonicalized and nullable barberId is preserved", () => {
  const withDates = buildCurrentSalonArchiveState({
    ...v5Base,
    availability: [{ ...v5Availability, createdAt: new Date("2026-01-01T09:00:00Z") }],
  });
  const withStrings = buildCurrentSalonArchiveState({
    ...v5Base,
    availability: [{ ...v5Availability }],
  });
  assert.deepEqual(withDates, withStrings);
  const parsed = JSON.parse(withDates.sourceState.availabilityContent![0]);
  assert.ok(parsed[6].includes(".000Z"));
  // nullable barberId preserved
  const withBarber = buildCurrentSalonArchiveState({
    ...v5Base,
    availability: [{ ...v5Availability, barberId: "b1" }],
  });
  const parsedBarber = JSON.parse(withBarber.sourceState.availabilityContent![0]);
  assert.equal(parsedBarber[2], "b1");
});

test("V5 barber detects each meaningful field change", () => {
  const build = (rows: object[]) => buildCurrentSalonArchiveState({ ...v5Base, barbers: rows });
  const before = build([v5Barber]);
  for (const [field, value] of Object.entries({ name: "Changed", specialty: "Color", isActive: false, createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z" })) {
    assert.notDeepEqual(build([{ ...v5Barber, [field]: value }]).sourceState, before.sourceState, field);
  }
});

test("V5 service detects each meaningful field change", () => {
  const build = (rows: object[]) => buildCurrentSalonArchiveState({ ...v5Base, services: rows });
  const before = build([v5Service]);
  for (const [field, value] of Object.entries({ name: "Color", description: "New", durationMin: 45, price: "15.00", isActive: false, createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z" })) {
    assert.notDeepEqual(build([{ ...v5Service, [field]: value }]).sourceState, before.sourceState, field);
  }
});

test("V5 availability detects each meaningful field change", () => {
  const build = (rows: object[]) => buildCurrentSalonArchiveState({ ...v5Base, availability: rows });
  const before = build([v5Availability]);
  for (const [field, value] of Object.entries({ barberId: "b1", startAt: "2026-02-01T10:00:00Z", endAt: "2026-02-01T11:00:00Z", status: "BOOKED", createdAt: "2026-02-01T00:00:00Z" })) {
    assert.notDeepEqual(build([{ ...v5Availability, [field]: value }]).sourceState, before.sourceState, field);
  }
});

// ── V6 archive contract: Loyalty chain evidence completion ──

const v6Base = { salonId: "target", bookingIds: [], serviceVisitIds: [], salonBoostIds: [] };

const v6LoyaltyCard = {
  id: "card-1", salonId: "target", isActive: true, requiredStamps: 8,
  rewardType: "FREE_SERVICE", rewardTitle: "Free cut", rewardText: "Free cut",
  description: null,
  createdAt: "2026-01-01T09:00:00Z", updatedAt: "2026-01-01T10:00:00Z",
  customers: [], stamps: [],
};

const v6LoyaltyCustomer = {
  id: "cust-1", cardId: "card-1", customerId: "user-1",
  currentStamps: 3, totalVisits: 5,
  lastStampedAt: "2026-01-01T10:00:00Z", rewardRedeemedAt: null,
  createdAt: "2026-01-01T09:00:00Z", updatedAt: "2026-01-01T10:00:00Z",
};

const v6LoyaltyStamp = {
  id: "stamp-1", cardId: "card-1", customerId: "user-1", barberId: "b1",
  transactionId: "tx-1", stampAt: "2026-01-01T10:00:00Z", isValid: true,
  verificationToken: "tok-1",
  createdAt: "2026-01-01T09:00:00Z",
};

test("V6 is legacy and not current deletion-eligible evidence after V7 bump", () => {
  const v6State = buildCurrentSalonArchiveState(
    { ...v7Base, salonBoosts: [{ ...v7SalonBoost }] },
    { archiveVersion: 6, payloadVersion: 6 },
  );
  assert.equal(v6State.archiveVersion, 6);
  assert.equal(v6State.payloadVersion, 6);
  assert.equal(isCurrentSalonArchiveContract(v6State), false);
  // V6 salonBoost tuple has 3 fields (id, salonId, status only)
  const parsed = JSON.parse(v6State.sourceState.salonBoostContent![0]);
  assert.equal(parsed.length, 3);
});

test("V5 is legacy and not current deletion-eligible evidence after V6 bump", () => {
  const v5State = buildCurrentSalonArchiveState(
    { ...v6Base, loyalty: [{ ...v6LoyaltyCard, customers: [], stamps: [] }] },
    { archiveVersion: 5, payloadVersion: 5 },
  );
  assert.equal(v5State.archiveVersion, 5);
  assert.equal(v5State.payloadVersion, 5);
  assert.equal(isCurrentSalonArchiveContract(v5State), false);
  // V5 loyalty card tuple has 11 elements (9 card fields + 2 nested child arrays, no updatedAt)
  const parsed = JSON.parse(v5State.sourceState.loyaltyContent![0]);
  assert.equal(parsed.length, 11);
});

test("V6 LoyaltyCard archive evidence includes all 10 persisted fields", () => {
  const state = buildCurrentSalonArchiveState({
    ...v6Base,
    loyalty: [{ ...v6LoyaltyCard, customers: [], stamps: [] }],
  });
  const content = state.sourceState.loyaltyContent!;
  assert.equal(content.length, 1);
  const parsed = JSON.parse(content[0]);
  // V6 tuple: [id, salonId, isActive, requiredStamps, rewardType, rewardTitle, rewardText, description, createdAt, updatedAt, customers[], stamps[]]
  assert.equal(parsed[0], "card-1");
  assert.equal(parsed[1], "target");
  assert.equal(parsed[2], true);
  assert.equal(parsed[3], 8);
  assert.equal(parsed[4], "FREE_SERVICE");
  assert.equal(parsed[5], "Free cut");
  assert.equal(parsed[6], "Free cut");
  assert.equal(parsed[7], null);
  assert.equal(parsed[8], "2026-01-01T09:00:00.000Z");
  assert.equal(parsed[9], "2026-01-01T10:00:00.000Z");
  assert.ok(Array.isArray(parsed[10]));
  assert.ok(Array.isArray(parsed[11]));
  assert.equal(parsed.length, 12);
});

test("V6 LoyaltyCustomer archive evidence includes all 9 persisted fields", () => {
  const state = buildCurrentSalonArchiveState({
    ...v6Base,
    loyalty: [{ ...v6LoyaltyCard, customers: [{ ...v6LoyaltyCustomer }], stamps: [] }],
  });
  const content = state.sourceState.loyaltyContent!;
  assert.equal(content.length, 1);
  const parsed = JSON.parse(content[0]);
  const customerTuple = JSON.parse(parsed[10][0]);
  // V6 tuple: [id, cardId, customerId, currentStamps, totalVisits, lastStampedAt, rewardRedeemedAt, createdAt, updatedAt]
  assert.equal(customerTuple[0], "cust-1");
  assert.equal(customerTuple[1], "card-1");
  assert.equal(customerTuple[2], "user-1");
  assert.equal(customerTuple[3], 3);
  assert.equal(customerTuple[4], 5);
  assert.equal(customerTuple[5], "2026-01-01T10:00:00.000Z");
  assert.equal(customerTuple[6], null);
  assert.equal(customerTuple[7], "2026-01-01T09:00:00.000Z");
  assert.equal(customerTuple[8], "2026-01-01T10:00:00.000Z");
  assert.equal(customerTuple.length, 9);
});

test("V6 LoyaltyStamp archive evidence includes all 9 persisted fields", () => {
  const state = buildCurrentSalonArchiveState({
    ...v6Base,
    loyalty: [{ ...v6LoyaltyCard, customers: [], stamps: [{ ...v6LoyaltyStamp }] }],
  });
  const content = state.sourceState.loyaltyContent!;
  assert.equal(content.length, 1);
  const parsed = JSON.parse(content[0]);
  const stampTuple = JSON.parse(parsed[11][0]);
  // V6 tuple: [id, cardId, customerId, barberId, transactionId, stampAt, isValid, verificationToken, createdAt]
  assert.equal(stampTuple[0], "stamp-1");
  assert.equal(stampTuple[1], "card-1");
  assert.equal(stampTuple[2], "user-1");
  assert.equal(stampTuple[3], "b1");
  assert.equal(stampTuple[4], "tx-1");
  assert.equal(stampTuple[5], "2026-01-01T10:00:00.000Z");
  assert.equal(stampTuple[6], true);
  assert.equal(stampTuple[7], "tok-1");
  assert.equal(stampTuple[8], "2026-01-01T09:00:00.000Z");
  assert.equal(stampTuple.length, 9);
});

test("V6 loyalty DateTime fields are canonicalized and nullable verificationToken is preserved", () => {
  const withDates = buildCurrentSalonArchiveState({
    ...v6Base,
    loyalty: [{ ...v6LoyaltyCard, createdAt: new Date("2026-01-01T09:00:00Z"), updatedAt: new Date("2026-01-01T10:00:00Z"),
      customers: [{ ...v6LoyaltyCustomer, lastStampedAt: new Date("2026-01-01T10:00:00Z"), createdAt: new Date("2026-01-01T09:00:00Z"), updatedAt: new Date("2026-01-01T10:00:00Z") }],
      stamps: [{ ...v6LoyaltyStamp, stampAt: new Date("2026-01-01T10:00:00Z"), createdAt: new Date("2026-01-01T09:00:00Z") }],
    }],
  });
  const withStrings = buildCurrentSalonArchiveState({
    ...v6Base,
    loyalty: [{ ...v6LoyaltyCard, customers: [{ ...v6LoyaltyCustomer }], stamps: [{ ...v6LoyaltyStamp }] }],
  });
  assert.deepEqual(withDates, withStrings);
  const parsed = JSON.parse(withDates.sourceState.loyaltyContent![0]);
  // card tuple dates at indices 8,9
  assert.ok(parsed[8].includes(".000Z"));
  assert.ok(parsed[9].includes(".000Z"));
  // customer dates at indices 5,7,8
  const customerTuple = JSON.parse(parsed[10][0]);
  assert.ok(customerTuple[5].includes(".000Z"));
  assert.ok(customerTuple[7].includes(".000Z"));
  assert.ok(customerTuple[8].includes(".000Z"));
  // stamp dates at indices 5,8
  const stampTuple = JSON.parse(parsed[11][0]);
  assert.ok(stampTuple[5].includes(".000Z"));
  assert.ok(stampTuple[8].includes(".000Z"));
  // nullable verificationToken preserved
  const withNull = buildCurrentSalonArchiveState({
    ...v6Base,
    loyalty: [{ ...v6LoyaltyCard, customers: [], stamps: [{ ...v6LoyaltyStamp, verificationToken: null }] }],
  });
  const parsedNull = JSON.parse(withNull.sourceState.loyaltyContent![0]);
  const stampNull = JSON.parse(parsedNull[11][0]);
  assert.equal(stampNull[7], null);
});

test("V6 loyalty detects each meaningful field change", () => {
  const buildCard = (card: object) => buildCurrentSalonArchiveState({ ...v6Base, loyalty: [{ ...card, customers: v6LoyaltyCard.customers, stamps: v6LoyaltyCard.stamps }] });
  const beforeCard = buildCard(v6LoyaltyCard);
  for (const [field, value] of Object.entries({ isActive: false, requiredStamps: 9, rewardType: "FIXED_DISCOUNT", rewardTitle: "New", rewardText: "New", description: "Desc", createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z" })) {
    assert.notDeepEqual(buildCard({ ...v6LoyaltyCard, [field]: value }).sourceState, beforeCard.sourceState, field);
  }
  const buildCustomer = (cust: object[]) => buildCurrentSalonArchiveState({ ...v6Base, loyalty: [{ ...v6LoyaltyCard, customers: cust, stamps: [] }] });
  const beforeCustomer = buildCustomer([v6LoyaltyCustomer]);
  for (const [field, value] of Object.entries({ currentStamps: 4, totalVisits: 6, lastStampedAt: "2026-02-01T00:00:00Z", rewardRedeemedAt: "2026-02-01T00:00:00Z", createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z" })) {
    assert.notDeepEqual(buildCustomer([{ ...v6LoyaltyCustomer, [field]: value }]).sourceState, beforeCustomer.sourceState, field);
  }
  const buildStamp = (stamps: object[]) => buildCurrentSalonArchiveState({ ...v6Base, loyalty: [{ ...v6LoyaltyCard, customers: [], stamps }] });
  const beforeStamp = buildStamp([v6LoyaltyStamp]);
  for (const [field, value] of Object.entries({ barberId: "b2", transactionId: "tx-2", stampAt: "2026-02-01T00:00:00Z", isValid: false, verificationToken: "tok-2", createdAt: "2026-02-01T00:00:00Z" })) {
    assert.notDeepEqual(buildStamp([{ ...v6LoyaltyStamp, [field]: value }]).sourceState, beforeStamp.sourceState, field);
  }
});

// ── V7 archive contract: SalonBoost + Offer evidence completion ──

const v7Base = { salonId: "target", bookingIds: [], serviceVisitIds: [], salonBoostIds: [] };

const v7SalonBoost = {
  id: "boost-1", salonId: "target", status: "ACTIVE",
  durationDays: 7, startsAt: "2026-01-01T10:00:00Z", endsAt: "2026-01-08T10:00:00Z",
  amountCents: 500, currency: "EUR", providerReference: "ref-1",
  paymentIntentId: "pi-1", notes: "Promo boost",
  createdAt: "2026-01-01T09:00:00Z", updatedAt: "2026-01-01T10:00:00Z",
};

const v7Offer = {
  id: "offer-1", salonId: "target", title: "Summer Cut",
  description: "Discounted cut", price: "25.00", isActive: true,
  availableSlots: 5, discount: "5.00",
  endAt: "2026-02-01T10:00:00Z", endTime: "18:00",
  serviceName: "Haircut", startAt: "2026-01-01T10:00:00Z", startTime: "09:00",
  createdAt: "2026-01-01T09:00:00Z", updatedAt: "2026-01-01T10:00:00Z",
};

test("V7 is the current archive/payload contract", () => {
  assert.equal(SALON_ARCHIVE_VERSION, 7);
  assert.equal(SALON_ARCHIVE_PAYLOAD_VERSION, 7);
  const state = buildCurrentSalonArchiveState({ ...v7Base, salonBoosts: [{ ...v7SalonBoost }] });
  assert.equal(state.archiveVersion, 7);
  assert.equal(state.payloadVersion, 7);
  assert.ok(isCurrentSalonArchiveContract({ archiveVersion: 7, payloadVersion: 7 }));
  assert.equal(isCurrentSalonArchiveContract({ archiveVersion: 6, payloadVersion: 6 }), false);
});

test("V6 is legacy and not current deletion-eligible evidence after V7 bump", () => {
  const v6State = buildCurrentSalonArchiveState(
    { ...v7Base, salonBoosts: [{ ...v7SalonBoost }] },
    { archiveVersion: 6, payloadVersion: 6 },
  );
  assert.equal(v6State.archiveVersion, 6);
  assert.equal(v6State.payloadVersion, 6);
  assert.equal(isCurrentSalonArchiveContract(v6State), false);
  // V6 salonBoost tuple has 3 fields (id, salonId, status only)
  const parsed = JSON.parse(v6State.sourceState.salonBoostContent![0]);
  assert.equal(parsed.length, 3);
});

test("V6 Offer tuple is legacy with 13 fields (no createdAt/updatedAt)", () => {
  const v6State = buildCurrentSalonArchiveState(
    { ...v7Base, offers: [{ ...v7Offer }] },
    { archiveVersion: 6, payloadVersion: 6 },
  );
  assert.equal(v6State.archiveVersion, 6);
  assert.equal(v6State.payloadVersion, 6);
  assert.equal(isCurrentSalonArchiveContract(v6State), false);
  const parsed = JSON.parse(v6State.sourceState.offerContent![0]);
  assert.equal(parsed.length, 13);
});

test("V7 SalonBoost archive evidence includes all 13 persisted fields", () => {
  const state = buildCurrentSalonArchiveState({
    ...v7Base,
    salonBoosts: [{ ...v7SalonBoost }],
  });
  const content = state.sourceState.salonBoostContent!;
  assert.equal(content.length, 1);
  const parsed = JSON.parse(content[0]);
  // V7 tuple: [id, salonId, status, durationDays, startsAt, endsAt, amountCents, currency, providerReference, paymentIntentId, notes, createdAt, updatedAt]
  assert.equal(parsed[0], "boost-1");
  assert.equal(parsed[1], "target");
  assert.equal(parsed[2], "ACTIVE");
  assert.equal(parsed[3], 7);
  assert.equal(parsed[4], "2026-01-01T10:00:00.000Z");
  assert.equal(parsed[5], "2026-01-08T10:00:00.000Z");
  assert.equal(parsed[6], 500);
  assert.equal(parsed[7], "EUR");
  assert.equal(parsed[8], "ref-1");
  assert.equal(parsed[9], "pi-1");
  assert.equal(parsed[10], "Promo boost");
  assert.equal(parsed[11], "2026-01-01T09:00:00.000Z");
  assert.equal(parsed[12], "2026-01-01T10:00:00.000Z");
  assert.equal(parsed.length, 13);
});

test("V7 SalonBoost DateTime fields are canonicalized and nullable fields are preserved", () => {
  const withDates = buildCurrentSalonArchiveState({
    ...v7Base,
    salonBoosts: [{
      ...v7SalonBoost,
      startsAt: new Date("2026-01-01T10:00:00Z"),
      endsAt: new Date("2026-01-08T10:00:00Z"),
      createdAt: new Date("2026-01-01T09:00:00Z"),
      updatedAt: new Date("2026-01-01T10:00:00Z"),
    }],
  });
  const withStrings = buildCurrentSalonArchiveState({
    ...v7Base,
    salonBoosts: [{ ...v7SalonBoost }],
  });
  assert.deepEqual(withDates, withStrings);
  const parsed = JSON.parse(withDates.sourceState.salonBoostContent![0]);
  assert.ok(parsed[4].includes(".000Z"));
  assert.ok(parsed[5].includes(".000Z"));
  assert.ok(parsed[11].includes(".000Z"));
  assert.ok(parsed[12].includes(".000Z"));
  // nullable fields preserved
  const withNulls = buildCurrentSalonArchiveState({
    ...v7Base,
    salonBoosts: [{
      ...v7SalonBoost,
      startsAt: null, endsAt: null, amountCents: null, currency: null,
      providerReference: null, paymentIntentId: null, notes: null,
    }],
  });
  const parsedNulls = JSON.parse(withNulls.sourceState.salonBoostContent![0]);
  assert.equal(parsedNulls[4], null);
  assert.equal(parsedNulls[5], null);
  assert.equal(parsedNulls[6], null);
  assert.equal(parsedNulls[7], null);
  assert.equal(parsedNulls[8], null);
  assert.equal(parsedNulls[9], null);
  assert.equal(parsedNulls[10], null);
});

test("V7 SalonBoost detects each meaningful field change", () => {
  const build = (boosts: object[]) => buildCurrentSalonArchiveState({ ...v7Base, salonBoosts: boosts });
  const before = build([v7SalonBoost]);
  for (const [field, value] of Object.entries({
    status: "EXPIRED", durationDays: 14, startsAt: "2026-02-01T10:00:00Z", endsAt: "2026-02-15T10:00:00Z",
    amountCents: 1000, currency: "USD", providerReference: "ref-2", paymentIntentId: "pi-2",
    notes: "Updated", createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z",
  })) {
    assert.notDeepEqual(build([{ ...v7SalonBoost, [field]: value }]).sourceState, before.sourceState, field);
  }
});

test("V7 Offer archive evidence includes all 15 persisted fields", () => {
  const state = buildCurrentSalonArchiveState({
    ...v7Base,
    offers: [{ ...v7Offer }],
  });
  const content = state.sourceState.offerContent!;
  assert.equal(content.length, 1);
  const parsed = JSON.parse(content[0]);
  // V7 tuple: [id, salonId, title, description, price, isActive, availableSlots, discount, endAt, endTime, serviceName, startAt, startTime, createdAt, updatedAt]
  assert.equal(parsed[0], "offer-1");
  assert.equal(parsed[1], "target");
  assert.equal(parsed[2], "Summer Cut");
  assert.equal(parsed[3], "Discounted cut");
  assert.equal(parsed[4], "25");
  assert.equal(parsed[5], true);
  assert.equal(parsed[6], 5);
  assert.equal(parsed[7], "5");
  assert.equal(parsed[8], "2026-02-01T10:00:00.000Z");
  assert.equal(parsed[9], "18:00");
  assert.equal(parsed[10], "Haircut");
  assert.equal(parsed[11], "2026-01-01T10:00:00.000Z");
  assert.equal(parsed[12], "09:00");
  assert.equal(parsed[13], "2026-01-01T09:00:00.000Z");
  assert.equal(parsed[14], "2026-01-01T10:00:00.000Z");
  assert.equal(parsed.length, 15);
});

test("V7 Offer DateTime fields are canonicalized and nullable fields are preserved", () => {
  const withDates = buildCurrentSalonArchiveState({
    ...v7Base,
    offers: [{
      ...v7Offer,
      endAt: new Date("2026-02-01T10:00:00Z"),
      startAt: new Date("2026-01-01T10:00:00Z"),
      createdAt: new Date("2026-01-01T09:00:00Z"),
      updatedAt: new Date("2026-01-01T10:00:00Z"),
    }],
  });
  const withStrings = buildCurrentSalonArchiveState({
    ...v7Base,
    offers: [{ ...v7Offer }],
  });
  assert.deepEqual(withDates, withStrings);
  const parsed = JSON.parse(withDates.sourceState.offerContent![0]);
  assert.ok(parsed[8].includes(".000Z"));
  assert.ok(parsed[11].includes(".000Z"));
  assert.ok(parsed[13].includes(".000Z"));
  assert.ok(parsed[14].includes(".000Z"));
  // nullable fields preserved
  const withNulls = buildCurrentSalonArchiveState({
    ...v7Base,
    offers: [{
      ...v7Offer,
      description: null, price: null, availableSlots: null, discount: null,
      endAt: null, endTime: null, serviceName: null, startAt: null, startTime: null,
    }],
  });
  const parsedNulls = JSON.parse(withNulls.sourceState.offerContent![0]);
  assert.equal(parsedNulls[3], null);
  assert.equal(parsedNulls[4], null);
  assert.equal(parsedNulls[6], null);
  assert.equal(parsedNulls[7], null);
  assert.equal(parsedNulls[8], null);
  assert.equal(parsedNulls[9], null);
  assert.equal(parsedNulls[10], null);
  assert.equal(parsedNulls[11], null);
  assert.equal(parsedNulls[12], null);
});

test("V7 Offer Decimal values use existing canonical representation", () => {
  const build = (price: string | null) => buildCurrentSalonArchiveState({ ...v7Base, offers: [{ ...v7Offer, price }] });
  assert.deepEqual(build("25.00"), build("25.000"));
  assert.deepEqual(build("5.00"), build("5.000"));
  assert.notDeepEqual(build(null).sourceState, build("0").sourceState);
  const buildDiscount = (discount: string | null) => buildCurrentSalonArchiveState({ ...v7Base, offers: [{ ...v7Offer, discount }] });
  assert.deepEqual(buildDiscount("5.00"), buildDiscount("5.000"));
  assert.notDeepEqual(buildDiscount(null).sourceState, buildDiscount("0").sourceState);
});

test("V7 Offer detects each meaningful field change", () => {
  const build = (offers: object[]) => buildCurrentSalonArchiveState({ ...v7Base, offers: offers });
  const before = build([v7Offer]);
  for (const [field, value] of Object.entries({
    title: "Winter Cut", description: "New desc", price: "30.00", isActive: false,
    availableSlots: 10, discount: "10.00", endAt: "2026-03-01T10:00:00Z", endTime: "20:00",
    serviceName: "Color", startAt: "2026-02-01T10:00:00Z", startTime: "11:00",
    createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z",
  })) {
    assert.notDeepEqual(build([{ ...v7Offer, [field]: value }]).sourceState, before.sourceState, field);
  }
});
