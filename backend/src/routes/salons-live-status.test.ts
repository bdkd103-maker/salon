import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Fastify from "fastify";
import { prisma } from "../lib/prisma.js";
import { salonRoutes } from "./salons.js";

const originalSalon = prisma.salon;
afterEach(() => { (prisma as any).salon = originalSalon; });
const now = Date.parse("2026-09-09T12:00:00Z");
const fresh = {
  salonId: "salon-1", operationalState: "CLOSED",
  observedAt: new Date(now - 60_000), expiresAt: new Date(now + 60_000),
  source: "internal-source", createdAt: new Date(now), updatedAt: new Date(now),
};
const baseSalon = {
  id: "salon-1", name: "Test Salon", isActive: true, status: "OPEN",
  rating: "4.5", reviewCount: 3, classification: "REGULAR",
  openingTime: "09:00", closingTime: "21:00", workingDays: ["wed"], timeZone: "Europe/Berlin",
  updatedAt: new Date(now), barbers: [{ id: "barber-1", isActive: true }],
  services: [], offers: [], reviews: [], media: [],
};

for (const url of ["/api/v1/salons", "/api/v1/salons/salon-1"]) {
  const extract = (body: any) => body.salon ?? body.salons[0];
  for (const [label, snapshot] of [
    ["fresh", fresh],
    ["expired", { ...fresh, expiresAt: new Date(now - 1) }],
    ["at expiry boundary", { ...fresh, expiresAt: new Date(now) }],
    ["missing", null],
    ["unknown state", { ...fresh, operationalState: null }],
    ["blank state", { ...fresh, operationalState: " " }],
    ["unknown observation", { ...fresh, observedAt: null }],
    ["unknown expiry", { ...fresh, expiresAt: null }],
    ["invalid observation", { ...fresh, observedAt: new Date(NaN) }],
    ["invalid expiry", { ...fresh, expiresAt: new Date(NaN) }],
    ["future observation", { ...fresh, observedAt: new Date(now + 1) }],
    ["reversed interval", { ...fresh, observedAt: new Date(now + 120_000) }],
  ] as const) {
    test(`${url}: ${label} live status`, async (t) => {
      t.mock.method(Date, "now", () => now);
      (prisma as any).salon = {
        findMany: async (args: any) => {
          assert.deepEqual(args.where, { isActive: true });
          assert.deepEqual(args.include.liveStatus, { select: {
            operationalState: true, observedAt: true, expiresAt: true,
          } });
          return [{ ...baseSalon, liveStatus: snapshot }];
        },
      };
      const app = Fastify();
      await salonRoutes(app);
      try {
        const response = await app.inject({ method: "GET", url });
        assert.equal(response.statusCode, 200, response.body);
        const salon = extract(response.json());
        assert.deepEqual(salon.liveStatus, label === "fresh" ? {
          operationalState: "CLOSED",
          observedAt: fresh.observedAt.toISOString(), expiresAt: fresh.expiresAt.toISOString(),
        } : null);
        assert.equal(salon.status, "OPEN");
        assert.equal(salon.updatedAt, baseSalon.updatedAt.toISOString());
        for (const field of ["openingTime", "closingTime", "workingDays", "timeZone"] as const) {
          assert.deepEqual(salon[field], baseSalon[field]);
        }
      } finally { await app.close(); }
    });
  }

  test(`${url}: existing response stays compatible when live status is added`, async (t) => {
    t.mock.method(Date, "now", () => now);
    let record: any = { ...baseSalon };
    (prisma as any).salon = { findMany: async () => [record] };
    const app = Fastify();
    await salonRoutes(app);
    try {
      const before = await app.inject({ method: "GET", url });
      assert.equal(before.statusCode, 200);
      const baseline = extract(before.json());
      assert.equal(baseline.liveStatus, null);
      assert.equal(baseline.name, baseSalon.name);
      assert.equal(baseline.rating, 4.5);
      assert.equal(baseline.reviewCount, 3);
      assert.equal(baseline.barbers[0].isActive, true);
      assert.deepEqual(baseline.services, []);
      record = { ...baseSalon, liveStatus: fresh };
      const after = await app.inject({ method: "GET", url });
      assert.equal(after.statusCode, 200);
      const { liveStatus, ...existingFields } = extract(after.json());
      const { liveStatus: missing, ...baselineFields } = baseline;
      assert.deepEqual(existingFields, baselineFields);
      assert.deepEqual(Object.keys(liveStatus).sort(), ["expiresAt", "observedAt", "operationalState"]);
    } finally { await app.close(); }
  });
}

test("public salon reads retain empty list and missing-salon responses", async () => {
  (prisma as any).salon = { findMany: async () => [] };
  const app = Fastify();
  await salonRoutes(app);
  try {
    const list = await app.inject({ method: "GET", url: "/api/v1/salons" });
    assert.equal(list.statusCode, 200);
    assert.deepEqual(list.json(), { salons: [] });
    const detail = await app.inject({ method: "GET", url: "/api/v1/salons/missing" });
    assert.equal(detail.statusCode, 404);
    assert.deepEqual(detail.json(), { error: "Salon not found" });
  } finally { await app.close(); }
});
