import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { summarizeAdminDashboard } from "./admin-dashboard.js";

describe("summarizeAdminDashboard", () => {
  it("aggregates real backend counts from users, salons, bookings and analytics", () => {
    const summary = summarizeAdminDashboard({
      users: [
        { id: "u1", role: "CUSTOMER" },
        { id: "u2", role: "OWNER" },
        { id: "u3", role: "ADMIN" },
      ],
      salons: [
        { id: "s1", isActive: true, isVip: true, adminVip: true, classification: "REGULAR", status: "OPEN" },
        { id: "s2", isActive: true, isVip: false, adminVip: false, classification: "PREMIUM", status: "BUSY" },
        { id: "s3", isActive: false, isVip: false, adminVip: false, classification: "REGULAR", status: "CLOSED" },
      ],
      barbers: [
        { id: "b1", isActive: true },
        { id: "b2", isActive: false },
      ],
      availabilitySlots: [
        { id: "a1", status: "AVAILABLE" },
        { id: "a2", status: "AVAILABLE" },
        { id: "a3", status: "BOOKED" },
        { id: "a4", status: "BLOCKED" },
      ],
      bookings: [
        { id: "b1", status: "PENDING", startAt: "2026-08-30T09:00:00.000Z" },
        { id: "b2", status: "CONFIRMED", startAt: "2026-08-29T10:00:00.000Z" },
        { id: "b3", status: "CANCELLED", startAt: "2026-08-28T10:00:00.000Z" },
      ],
      subscriptions: [
        { status: "ACTIVE" },
        { status: "CANCELLED" },
        { status: "ACTIVE" },
      ],
      reviews: [
        { id: "r1" },
        { id: "r2" },
      ],
      offers: [
        { id: "o1", isActive: true },
        { id: "o2", isActive: false },
      ],
      analyticsEvents: [
        { eventType: "favorite_click" },
        { eventType: "favorite_click" },
        { eventType: "new_customer" },
      ],
      notifications: [
        { id: "n1" },
        { id: "n2" },
      ],
      boosts: [
        { id: "b1", status: "ACTIVE" },
        { id: "b2", status: "EXPIRED" },
      ],
      loyaltyCards: [
        { id: "l1", isActive: true },
        { id: "l2", isActive: false },
      ],
    });

    assert.equal(summary.totalUsers, 3);
    assert.equal(summary.totalSalons, 3);
    assert.equal(summary.activeSalons, 2);
    assert.equal(summary.totalBarbers, 2);
    assert.equal(summary.activeBarbers, 1);
    assert.equal(summary.totalAvailabilitySlots, 4);
    assert.equal(summary.availableSlots, 2);
    assert.equal(summary.bookedSlots, 1);
    assert.equal(summary.blockedSlots, 1);
    assert.equal(summary.activeSubscriptions, 2);
    assert.equal(summary.premiumSalons, 1);
    assert.equal(summary.manualVipSalons, 1);
    assert.equal(summary.totalBookings, 3);
    assert.equal(summary.pendingBookings, 1);
    assert.equal(summary.totalReviews, 2);
    assert.equal(summary.totalOffers, 2);
    assert.equal(summary.totalFavorites, 2);
    assert.equal(summary.totalNotifications, 2);
    assert.equal(summary.totalBoosts, 2);
    assert.equal(summary.activeBoosts, 1);
    assert.equal(summary.totalLoyaltyCards, 2);
    assert.equal(summary.activeLoyaltyCards, 1);
  });
});
