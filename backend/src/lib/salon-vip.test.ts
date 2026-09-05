import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildPublicSalonState,
  getAutoVipSalonIds,
  getManualVipSalonIds,
  MAX_ADMIN_VIP_SLOTS,
  MAX_AUTO_VIP_SLOTS,
} from "./salon-vip.js";

describe("salon VIP helpers", () => {
  it("keeps manual VIPs capped at five and auto VIPs separate from them", () => {
    const salons = [
      { id: "a", name: "A", adminVip: true, createdAt: "2026-01-01T00:00:00.000Z", rating: 5, reviewCount: 8, isActive: true },
      { id: "b", name: "B", adminVip: true, createdAt: "2026-01-02T00:00:00.000Z", rating: 4.9, reviewCount: 7, isActive: true },
      { id: "c", name: "C", adminVip: true, createdAt: "2026-01-03T00:00:00.000Z", rating: 4.8, reviewCount: 6, isActive: true },
      { id: "d", name: "D", adminVip: true, createdAt: "2026-01-04T00:00:00.000Z", rating: 4.7, reviewCount: 5, isActive: true },
      { id: "e", name: "E", adminVip: true, createdAt: "2026-01-05T00:00:00.000Z", rating: 4.6, reviewCount: 4, isActive: true },
      { id: "f", name: "F", adminVip: true, createdAt: "2026-01-06T00:00:00.000Z", rating: 4.5, reviewCount: 3, isActive: true },
      { id: "g", name: "G", classification: "PREMIUM", rating: 4.95, reviewCount: 22, isActive: true },
      { id: "h", name: "H", classification: "REGULAR", rating: 4.9, reviewCount: 19, isActive: true },
      { id: "i", name: "I", classification: "REGULAR", rating: 4.85, reviewCount: 17, isActive: true },
      { id: "j", name: "J", classification: "PREMIUM", rating: 4.8, reviewCount: 14, isActive: true },
      { id: "k", name: "K", classification: "REGULAR", rating: 4.75, reviewCount: 12, isActive: true },
      { id: "l", name: "L", classification: "REGULAR", rating: 4.7, reviewCount: 0, isActive: true },
    ];

    const manualVipIds = getManualVipSalonIds(salons);
    const autoVipIds = getAutoVipSalonIds(salons);

    assert.equal(manualVipIds.length, MAX_ADMIN_VIP_SLOTS);
    assert.equal(autoVipIds.length, MAX_AUTO_VIP_SLOTS);
    assert.deepEqual(manualVipIds, ["a", "b", "c", "d", "e"]);
    assert.deepEqual(autoVipIds, ["g", "h", "i", "j", "k"]);
    assert.equal(autoVipIds.some((id) => manualVipIds.includes(id)), false);
  });

  it("keeps Premium independent from VIP unless the salon is selected into VIP", () => {
    const adminVipIds = new Set(["vip-1"]);
    const autoVipIds = new Set(["vip-2"]);

    assert.deepEqual(
      buildPublicSalonState({ id: "premium-1", classification: "PREMIUM" }),
      {
        baseClassification: "PREMIUM",
        classification: "PREMIUM",
        vipSource: "NONE",
        adminVip: false,
        isVip: false,
      },
    );

    assert.deepEqual(
      buildPublicSalonState({ id: "vip-1", classification: "REGULAR" }, { adminVipIds, autoVipIds }),
      {
        baseClassification: "REGULAR",
        classification: "VIP",
        vipSource: "ADMIN",
        adminVip: true,
        isVip: true,
      },
    );

    assert.deepEqual(
      buildPublicSalonState({ id: "vip-2", classification: "PREMIUM" }, { adminVipIds, autoVipIds }),
      {
        baseClassification: "PREMIUM",
        classification: "VIP",
        vipSource: "AUTO_RATING",
        adminVip: false,
        isVip: true,
      },
    );
  });
});
