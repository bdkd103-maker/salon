import assert from "node:assert/strict";
test("loyalty child history is canonical, content-aware and card-scoped", () => {
  const card = nextCategories[1][4];
  const customer = { id: "c", cardId: "a", customerId: "u", currentStamps: 2, totalVisits: 3, lastStampedAt: null, rewardRedeemedAt: null };
  const stamp = { id: "s", cardId: "a", customerId: "u", barberId: null, transactionId: "tx", stampAt: "2026-01-01T10:00:00Z", isValid: true };
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
const workforceCategories = [["services","SERVICE","serviceContent","id",{"id":"a","salonId":"target","name":"Cut","description":null,"durationMin":30,"price":"12.30","isActive":true},{"name":"Color","description":"New","durationMin":45,"price":"12.31","isActive":false}],["availability","AVAILABILITY","availabilityContent","id",{"id":"a","salonId":"target","barberId":null,"startAt":"2026-01-01T10:00:00Z","endAt":"2026-01-01T11:00:00Z","status":"AVAILABLE"},{"barberId":"b","startAt":"2026-01-01T10:30:00Z","endAt":"2026-01-01T11:30:00Z","status":"BOOKED"}],["staffMemberships","STAFF_MEMBERSHIP","staffMembershipContent","id",{"id":"a","salonId":"target","userId":"u","barberId":"b","status":"ACTIVE","revokedAt":null},{"userId":"v","barberId":"c","status":"REVOKED","revokedAt":"2026-01-01T10:00:00Z"}],["staffPresence","STAFF_PRESENCE","staffPresenceContent","staffMembershipId",{"staffMembershipId":"a","dutyState":"ON_DUTY","generation":1,"changedAt":"2026-01-01T10:00:00Z","changedByUserId":null,"changeSource":"STAFF"},{"dutyState":"OFF_DUTY","generation":2,"changedAt":"2026-01-01T11:00:00Z","changedByUserId":"u","changeSource":"OWNER"}]] as const;
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
