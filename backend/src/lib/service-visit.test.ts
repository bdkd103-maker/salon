import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  deriveStaffOccupancy,
  isAllowedServiceVisitTransition,
  isValidServiceVisitLifecycle,
  isValidServiceVisitStartContext,
} from "./service-visit.js";

const now = new Date("2026-09-10T12:00:00.000Z");
const baseStartContext = {
  source: "WALK_IN" as const,
  salonId: "salon-1",
  bookingId: null,
  bookingSalonId: null,
  staffMembershipId: "membership-1",
  membershipId: "membership-1",
  membershipSalonId: "salon-1",
  membershipStatus: "ACTIVE",
  membershipRevokedAt: null,
  presenceState: "ON_DUTY_CONFIRMED" as const,
};

test("an immediate anonymous walk-in can start without Booking or QueueEntry", () => {
  assert.equal(isValidServiceVisitStartContext(baseStartContext), true);
  assert.equal("queueEntryId" in baseStartContext, false);
});

test("BOOKING execution requires a same-salon Booking", () => {
  assert.equal(isValidServiceVisitStartContext({
    ...baseStartContext,
    source: "BOOKING",
    bookingId: "booking-1",
    bookingSalonId: "salon-1",
  }), true);
  assert.equal(isValidServiceVisitStartContext({
    ...baseStartContext,
    source: "BOOKING",
    bookingId: null,
  }), false);
  assert.equal(isValidServiceVisitStartContext({
    ...baseStartContext,
    source: "BOOKING",
    bookingId: "booking-2",
    bookingSalonId: "salon-2",
  }), false);
});

test("WALK_IN execution rejects a Booking reference", () => {
  assert.equal(isValidServiceVisitStartContext({
    ...baseStartContext,
    bookingId: "booking-1",
    bookingSalonId: "salon-1",
  }), false);
});

test("start context requires active same-salon membership and confirmed presence", () => {
  assert.equal(isValidServiceVisitStartContext({ ...baseStartContext, membershipSalonId: "salon-2" }), false);
  assert.equal(isValidServiceVisitStartContext({ ...baseStartContext, membershipId: "membership-2" }), false);
  assert.equal(isValidServiceVisitStartContext({ ...baseStartContext, membershipStatus: "SUSPENDED" }), false);
  assert.equal(isValidServiceVisitStartContext({ ...baseStartContext, membershipRevokedAt: now }), false);
  assert.equal(isValidServiceVisitStartContext({ ...baseStartContext, presenceState: "STALE" }), false);
  assert.equal(isValidServiceVisitStartContext({ ...baseStartContext, presenceState: "OFF_DUTY" }), false);
});

test("only IN_SERVICE to terminal transitions are allowed", () => {
  assert.equal(isAllowedServiceVisitTransition("IN_SERVICE", "COMPLETED"), true);
  assert.equal(isAllowedServiceVisitTransition("IN_SERVICE", "CANCELLED"), true);
  assert.equal(isAllowedServiceVisitTransition("IN_SERVICE", "IN_SERVICE"), false);
  assert.equal(isAllowedServiceVisitTransition("COMPLETED", "CANCELLED"), false);
  assert.equal(isAllowedServiceVisitTransition("CANCELLED", "COMPLETED"), false);
});

test("lifecycle timestamps match IN_SERVICE, COMPLETED and CANCELLED", () => {
  assert.equal(isValidServiceVisitLifecycle({ status: "IN_SERVICE", startedAt: now, completedAt: null, cancelledAt: null, version: 1 }), true);
  assert.equal(isValidServiceVisitLifecycle({ status: "COMPLETED", startedAt: now, completedAt: new Date(now.getTime() + 1), cancelledAt: null, version: 2 }), true);
  assert.equal(isValidServiceVisitLifecycle({ status: "CANCELLED", startedAt: now, completedAt: null, cancelledAt: new Date(now.getTime() + 1), version: 2 }), true);
  assert.equal(isValidServiceVisitLifecycle({ status: "COMPLETED", startedAt: now, completedAt: new Date(now.getTime() - 1), cancelledAt: null, version: 2 }), false);
  assert.equal(isValidServiceVisitLifecycle({ status: "CANCELLED", startedAt: now, completedAt: null, cancelledAt: new Date(now.getTime() - 1), version: 2 }), false);
  assert.equal(isValidServiceVisitLifecycle({ status: "IN_SERVICE", startedAt: now, completedAt: null, cancelledAt: null, version: 0 }), false);
});

test("active service remains BUSY even when presence is stale or off duty", () => {
  assert.equal(deriveStaffOccupancy("ON_DUTY_CONFIRMED", true), "BUSY");
  assert.equal(deriveStaffOccupancy("STALE", true), "BUSY");
  assert.equal(deriveStaffOccupancy("OFF_DUTY", true), "BUSY");
});

test("AVAILABLE requires confirmed presence and no active service", () => {
  assert.equal(deriveStaffOccupancy("ON_DUTY_CONFIRMED", false), "AVAILABLE");
  assert.equal(deriveStaffOccupancy("STALE", false), "NOT_AVAILABLE");
  assert.equal(deriveStaffOccupancy("OFF_DUTY", false), "NOT_AVAILABLE");
});

test("migration enforces source, same-salon, lifecycle and concurrent-service rules", () => {
  const migration = readFileSync(new URL("../../prisma/migrations/20260910130000_service_visit_foundation/migration.sql", import.meta.url), "utf8");

  assert.match(migration, /ServiceVisit_source_booking_check/);
  assert.match(migration, /ServiceVisit_lifecycle_check/);
  assert.match(migration, /ServiceVisit_version_check/);
  assert.match(migration, /FOREIGN KEY \("bookingId", "salonId"\) REFERENCES "Booking"\("id", "salonId"\)/);
  assert.match(migration, /FOREIGN KEY \("staffMembershipId", "salonId"\) REFERENCES "StaffMembership"\("id", "salonId"\)/);
  assert.match(migration, /CREATE UNIQUE INDEX "ServiceVisit_one_active_per_staff_key"[\s\S]*WHERE "status" = 'IN_SERVICE'/);
});

test("migration is additive and contains no queue, customer, duration or ETA fields", () => {
  const migration = readFileSync(new URL("../../prisma/migrations/20260910130000_service_visit_foundation/migration.sql", import.meta.url), "utf8");

  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE)\b|\bDELETE\s+FROM\b|\bUPDATE\s+[^;]+\s+SET\b|\bINSERT\s+INTO\b/i);
  // Ignore SQL comments: Prisma's "CreateTable" heading contains "eta".
  assert.doesNotMatch(migration.replace(/--[^\r\n]*/g, ""), /queue|ticket|customer|duration|estimated|eta/i);
});
