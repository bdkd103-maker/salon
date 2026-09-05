import assert from "node:assert/strict";
import test from "node:test";

import {
  getSalonOperatingState,
  getSalonWeeklySchedule,
  resolveSalonTimeZone,
} from "./salon-hours.js";

const berlinSalon = {
  timeZone: "Europe/Berlin",
  openingTime: "09:00",
  closingTime: "21:00",
  workingDays: ["mon"],
};

test("marks a salon open during a normal interval", () => {
  const state = getSalonOperatingState(berlinSalon, { now: new Date("2026-09-07T16:59:00.000Z") });
  assert.equal(state.key, "open");
});

test("marks a salon closed before opening", () => {
  const state = getSalonOperatingState(berlinSalon, { now: new Date("2026-09-07T06:59:00.000Z") });
  assert.equal(state.key, "closed");
});

test("marks a salon open at the exact opening time", () => {
  const state = getSalonOperatingState(berlinSalon, { now: new Date("2026-09-07T07:00:00.000Z") });
  assert.equal(state.key, "open");
});

test("marks a salon closed at the exact closing time", () => {
  const state = getSalonOperatingState(berlinSalon, { now: new Date("2026-09-07T19:00:00.000Z") });
  assert.equal(state.key, "closed");
});

test("marks a salon closed after closing", () => {
  const state = getSalonOperatingState(berlinSalon, { now: new Date("2026-09-07T21:30:00.000Z") });
  assert.equal(state.key, "closed");
});

test("marks a salon closed on a closed day", () => {
  const state = getSalonOperatingState(berlinSalon, { now: new Date("2026-09-08T10:00:00.000Z") });
  assert.equal(state.key, "closed");
});

test("supports multiple intervals on the same day", () => {
  const salon = {
    timeZone: "Europe/Berlin",
    weeklyOpeningHours: {
      sat: {
        intervals: [
          { open: "10:00", close: "14:00" },
          { open: "17:00", close: "22:00" },
        ],
      },
    },
  };

  assert.equal(getSalonOperatingState(salon, { now: new Date("2026-09-12T11:00:00.000Z") }).key, "open");
  assert.equal(getSalonOperatingState(salon, { now: new Date("2026-09-12T13:30:00.000Z") }).key, "closed");
  assert.equal(getSalonOperatingState(salon, { now: new Date("2026-09-12T16:00:00.000Z") }).key, "open");
  assert.equal(getSalonOperatingState(salon, { now: new Date("2026-09-12T20:01:00.000Z") }).key, "closed");
});

test("supports overnight intervals after midnight", () => {
  const salon = {
    timeZone: "Europe/Berlin",
    weeklyOpeningHours: {
      sat: {
        intervals: [{ open: "18:00", close: "02:00" }],
      },
    },
  };

  assert.equal(getSalonOperatingState(salon, { now: new Date("2026-09-12T17:30:00.000Z") }).key, "open");
  assert.equal(getSalonOperatingState(salon, { now: new Date("2026-09-13T00:30:00.000Z") }).key, "closed");
  assert.equal(getSalonOperatingState(salon, { now: new Date("2026-09-12T23:30:00.000Z") }).key, "open");
});

test("supports midnight transition from the previous day", () => {
  const salon = {
    timeZone: "Europe/Berlin",
    weeklyOpeningHours: {
      sun: {
        intervals: [{ open: "18:00", close: "02:00" }],
      },
    },
  };

  const mondayAfterMidnight = getSalonOperatingState(salon, { now: new Date("2026-09-13T23:30:00.000Z") });
  assert.equal(mondayAfterMidnight.key, "open");
});

test("treats missing hours as closed", () => {
  const state = getSalonOperatingState({ name: "No Hours" } as any, { now: new Date("2026-09-07T12:00:00.000Z") });
  assert.equal(state.key, "closed");
  assert.equal(state.reason, "missing-hours");
});

test("treats invalid hours as closed and records an error", () => {
  const schedule = getSalonWeeklySchedule({
    openingTime: "09:00",
    closingTime: "09:00",
    workingDays: ["mon"],
  });
  assert.equal(schedule.hasConfiguredHours, false);
  assert.ok(schedule.errors.length > 0);
});

test("uses the explicit salon timezone when available", () => {
  const salon = {
    timeZone: "America/New_York",
    openingTime: "09:00",
    closingTime: "10:00",
    workingDays: ["mon"],
  };
  const state = getSalonOperatingState(salon, { now: new Date("2026-09-07T13:30:00.000Z") });
  assert.equal(state.key, "open");
  assert.equal(resolveSalonTimeZone(salon), "America/New_York");
});

test("requires confirmed timezone metadata instead of guessing Berlin", () => {
  const salon = {
    openingTime: "09:00",
    closingTime: "10:00",
    workingDays: ["mon"],
  };
  const state = getSalonOperatingState(salon, { now: new Date("2026-09-07T13:30:00.000Z") });
  assert.equal(resolveSalonTimeZone(salon), "");
  assert.equal(state.reason, "missing-hours");
  assert.equal(state.key, "closed");
});

for (const timeZone of [null, "", "Invalid/Zone", "+02:00"]) {
  test(`does not open with unconfirmed timezone ${timeZone}`, () => {
    const state = getSalonOperatingState({ ...berlinSalon, timeZone }, { now: new Date("2026-09-07T18:59:00Z") });
    assert.equal(state.key, "closed");
    assert.equal(state.reason, "missing-hours");
  });
}

test("persisted working days obey 20:59, 21:00 and 23:30 in the salon timezone", () => {
  for (const [now, expected] of [["2026-09-07T18:59:00Z", "open"], ["2026-09-07T19:00:00Z", "closed"], ["2026-09-07T21:30:00Z", "closed"]]) {
    assert.equal(getSalonOperatingState(berlinSalon, { now: new Date(now) }).key, expected);
  }
});
