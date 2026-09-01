import test from "node:test";
import assert from "node:assert/strict";

import { getLoyaltyProgress, buildStampTransactionId } from "./loyalty.js";

test("loyalty progress computes remaining stamps correctly", () => {
  const progress = getLoyaltyProgress(5, 8);
  assert.equal(progress.stamps, 5);
  assert.equal(progress.requiredStamps, 8);
  assert.equal(progress.remaining, 3);
  assert.equal(progress.isRewardReady, false);
});

test("loyalty reward is ready when the required threshold is reached", () => {
  const progress = getLoyaltyProgress(8, 8);
  assert.equal(progress.remaining, 0);
  assert.equal(progress.isRewardReady, true);
});

test("stamp transaction IDs are unique and deterministic in format", () => {
  const first = buildStampTransactionId();
  const second = buildStampTransactionId();
  assert.ok(first.startsWith("stamp_"));
  assert.ok(second.startsWith("stamp_"));
  assert.notEqual(first, second);
});
