import assert from "node:assert/strict";
import test from "node:test";

import {
  getQueueTransition,
  isActiveSaloTicketStatus,
} from "./queue-entry";

test("WAITING can be called", () => {
  assert.equal(getQueueTransition("WAITING", "CALL"), "CALLED");
});

test("WAITING can start directly", () => {
  assert.equal(getQueueTransition("WAITING", "START"), "STARTED");
});

test("CALLED can start", () => {
  assert.equal(getQueueTransition("CALLED", "START"), "STARTED");
});

test("WAITING can be cancelled or expired", () => {
  assert.equal(getQueueTransition("WAITING", "CANCEL"), "CANCELLED");
  assert.equal(getQueueTransition("WAITING", "EXPIRE"), "EXPIRED");
});

test("CALLED can be cancelled, expired, or no-show", () => {
  assert.equal(getQueueTransition("CALLED", "CANCEL"), "CANCELLED");
  assert.equal(getQueueTransition("CALLED", "EXPIRE"), "EXPIRED");
  assert.equal(getQueueTransition("CALLED", "NO_SHOW"), "NO_SHOW");
});

test("terminal queue states cannot transition again", () => {
  for (const status of [
    "STARTED",
    "CANCELLED",
    "EXPIRED",
    "NO_SHOW",
  ] as const) {
    assert.throws(() => getQueueTransition(status, "START"));
  }
});

test("NO_SHOW is not allowed directly from WAITING", () => {
  assert.throws(() => getQueueTransition("WAITING", "NO_SHOW"));
});

test("only WAITING and CALLED are active SALO Ticket queue states", () => {
  assert.equal(isActiveSaloTicketStatus("WAITING"), true);
  assert.equal(isActiveSaloTicketStatus("CALLED"), true);
  assert.equal(isActiveSaloTicketStatus("STARTED"), false);
  assert.equal(isActiveSaloTicketStatus("CANCELLED"), false);
  assert.equal(isActiveSaloTicketStatus("EXPIRED"), false);
  assert.equal(isActiveSaloTicketStatus("NO_SHOW"), false);
});