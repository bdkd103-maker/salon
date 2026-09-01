import assert from "node:assert/strict";
import test from "node:test";

import {
  isWithinOperatingHours,
  parseWallClockInTimeZone,
} from "./booking-time.js";

test("converts Berlin wall-clock time to UTC correctly", () => {
  const value = parseWallClockInTimeZone("2026-08-28T09:30", "Europe/Berlin");
  assert.equal(value.toISOString(), "2026-08-28T07:30:00.000Z");
});

test("rejects bookings outside salon opening hours", () => {
  const allowed = isWithinOperatingHours(
    "2026-08-28T09:00",
    "2026-08-28T10:00",
    "Europe/Berlin",
    "09:00",
    "18:00",
  );
  const blocked = isWithinOperatingHours(
    "2026-08-28T08:00",
    "2026-08-28T09:00",
    "Europe/Berlin",
    "09:00",
    "18:00",
  );

  assert.equal(allowed, true);
  assert.equal(blocked, false);
});
