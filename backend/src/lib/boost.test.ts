import test from "node:test";
import assert from "node:assert/strict";

import { getBoostMeta, isBoostActive, normalizeBoostDuration, normalizeBoostStatus } from "./boost.js";

test("normalizeBoostDuration accepts supported featured durations", () => {
  assert.equal(normalizeBoostDuration("7"), 7);
  assert.equal(normalizeBoostDuration("14"), 14);
  assert.equal(normalizeBoostDuration("7 days"), 7);
  assert.equal(normalizeBoostDuration("14 days"), 14);
});

test("normalizeBoostStatus accepts active, expired and cancelled lifecycle values", () => {
  assert.equal(normalizeBoostStatus("active"), "ACTIVE");
  assert.equal(normalizeBoostStatus("expired"), "EXPIRED");
  assert.equal(normalizeBoostStatus("cancelled"), "CANCELLED");
  assert.equal(normalizeBoostStatus("unknown"), "ACTIVE");
});

test("boost metadata and activation state track the featured placement window", () => {
  const boostMeta = getBoostMeta(14);
  assert.equal(boostMeta.label, "14 Days");
  assert.equal(boostMeta.price, 39);
  assert.equal(boostMeta.durationDays, 14);

  const start = new Date(Date.now() - 1000 * 60 * 60 * 12);
  const end = new Date(Date.now() + 1000 * 60 * 60 * 12);
  assert.equal(isBoostActive({ status: "ACTIVE", startsAt: start, endsAt: end }), true);
  assert.equal(isBoostActive({ status: "EXPIRED", startsAt: start, endsAt: new Date(Date.now() - 1000 * 60 * 60) }), false);
});
