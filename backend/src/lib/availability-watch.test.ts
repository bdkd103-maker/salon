import test from "node:test";
import assert from "node:assert/strict";

import {
  dedupeNotificationKey,
  normalizeAvailabilitySubscriptionStatus,
  shouldNotifySalonAvailability,
} from "./push.js";

test("availability subscription status is normalized safely", () => {
  assert.equal(normalizeAvailabilitySubscriptionStatus("active"), "ACTIVE");
  assert.equal(normalizeAvailabilitySubscriptionStatus("cancelled"), "CANCELLED");
  assert.equal(normalizeAvailabilitySubscriptionStatus(undefined), "ACTIVE");
});

test("only real availability transitions trigger a new notification", () => {
  assert.equal(
    shouldNotifySalonAvailability({ previousAvailableChairs: 0, currentAvailableChairs: 1, status: "ACTIVE" }),
    true,
  );
  assert.equal(
    shouldNotifySalonAvailability({ previousAvailableChairs: 1, currentAvailableChairs: 2, status: "ACTIVE" }),
    false,
  );
  assert.equal(
    shouldNotifySalonAvailability({ previousAvailableChairs: 0, currentAvailableChairs: 0, status: "ACTIVE" }),
    false,
  );
  assert.equal(
    shouldNotifySalonAvailability({ previousAvailableChairs: 0, currentAvailableChairs: 1, status: "CANCELLED" }),
    false,
  );
});

test("notification dedupe key is stable for the same user and salon", () => {
  assert.equal(
    dedupeNotificationKey({ userId: "user-1", salonId: "salon-2" }),
    "user-1:salon-2:chair-available",
  );
});
