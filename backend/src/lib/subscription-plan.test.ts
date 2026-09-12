import test from "node:test";
import assert from "node:assert/strict";

import { getSubscriptionMeta, normalizeSubscriptionPlan, SUBSCRIPTION_PLAN_ORDER } from "./subscription-plan.js";

test("SMART normalizes without losing the plan", () => {
  for (const value of ["SMART", "smart", "  SmArT  "]) assert.equal(normalizeSubscriptionPlan(value), "SMART");
});

test("subscription hierarchy and metadata cover four tiers without invented SMART pricing", () => {
  assert.deepEqual(SUBSCRIPTION_PLAN_ORDER, ["FREE", "SMART", "PREMIUM", "PRO"]);
  for (const plan of SUBSCRIPTION_PLAN_ORDER) {
    assert.equal(getSubscriptionMeta(plan).label.toUpperCase(), plan);
    assert.ok(getSubscriptionMeta(plan).features.length > 0);
  }
  assert.equal(getSubscriptionMeta("SMART").monthlyPrice, null);
  assert.equal(getSubscriptionMeta("FREE").monthlyPrice, 0);
  assert.equal(getSubscriptionMeta("PRO").monthlyPrice, 19);
  assert.equal(getSubscriptionMeta("PREMIUM").monthlyPrice, 49);
});

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
