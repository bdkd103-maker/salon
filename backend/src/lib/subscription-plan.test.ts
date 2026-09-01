import test from "node:test";
import assert from "node:assert/strict";

import { getSubscriptionMeta, normalizeSubscriptionPlan } from "./subscription-plan.js";

test("normalizeSubscriptionPlan accepts values with different casing", () => {
  assert.equal(normalizeSubscriptionPlan("pro"), "PRO");
  assert.equal(normalizeSubscriptionPlan("PREMIUM"), "PREMIUM");
  assert.equal(normalizeSubscriptionPlan("free"), "FREE");
});

test("subscription metadata exposes the expected plan details", () => {
  const premium = getSubscriptionMeta("PREMIUM");
  assert.equal(premium.label, "Premium");
  assert.equal(premium.monthlyPrice, 49);
  assert.ok(Array.isArray(premium.features));
  assert.ok(premium.features.length > 0);
});
