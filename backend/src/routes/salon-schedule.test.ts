import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Fastify from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { signAccessToken } from "../lib/jwt.js";
import { salonScheduleFields } from "../lib/salon-schedule.js";
import { getSalonOperatingState } from "../lib/salon-hours.js";
import { salonRoutes } from "./salons.js";

const original = { user: prisma.user, salon: prisma.salon, $transaction: prisma.$transaction };
const mock = prisma as any;
afterEach(() => Object.assign(mock, original));
const schedule = { openingTime: "09:00", closingTime: "21:00", workingDays: ["mon", "fri"], timeZone: "America/New_York" };

test("schedule validation rejects invalid days, zones and times", () => {
  const schema = z.object(salonScheduleFields);
  assert.equal(schema.safeParse(schedule).success, true);
  assert.equal(schema.safeParse({}).success, true);
  assert.equal(schema.safeParse({ workingDays: [] }).success, true);
  for (const invalid of [
    { workingDays: ["monday"] }, { workingDays: '["mon"]' },
    { timeZone: "Invalid/Zone" }, { timeZone: "" }, { timeZone: "+02:00" },
    { openingTime: "9:00" }, { openingTime: "24:00" }, { closingTime: "21:60" },
  ]) assert.equal(schema.safeParse(invalid).success, false, JSON.stringify(invalid));
});

for (const role of ["OWNER", "ADMIN"] as const) {
  test(`${role} schedule saves persist and round-trip through the public API`, async () => {
    process.env.JWT_ACCESS_SECRET = "schedule-test-secret";
    let record: any = null;
    mock.user = { findUnique: async () => ({ id: "owner-1", role, status: "ACTIVE" }) };
    mock.salon = {
      findUnique: async ({ where }: any) => where.slug ? null : record,
      findMany: async () => record ? [record] : [],
      create: async ({ data }: any) => record = { id: "salon-1", isActive: true, media: [], services: [], reviews: [], ...data },
      update: async ({ data }: any) => record = { ...record, ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) },
    };
    mock.$transaction = async (callback: any) => callback({ salon: mock.salon });
    const app = Fastify();
    await salonRoutes(app);
    try {
      const headers = { authorization: `Bearer ${signAccessToken({ sub: "owner-1", role })}` };
      const created = await app.inject({ method: "POST", url: "/api/v1/salons", headers, payload: {
        name: "Schedule Salon", city: "New York", address: "100 Main Street", phone: "+12125550100", ...schedule,
      } });
      assert.equal(created.statusCode, 200, created.body);
      assert.deepEqual(record.workingDays, schedule.workingDays);
      assert.equal(record.timeZone, schedule.timeZone);
      const updated = await app.inject({ method: "PATCH", url: "/api/v1/salons/salon-1", headers, payload: {
        workingDays: ["tue"], timeZone: "Asia/Tokyo", closingTime: "20:00",
      } });
      assert.equal(updated.statusCode, 200, updated.body);
      assert.deepEqual(updated.json().salon.workingDays, ["tue"]);
      assert.equal(record.openingTime, "09:00");
      const partial = await app.inject({ method: "PATCH", url: "/api/v1/salons/salon-1", headers, payload: { name: "Renamed Salon" } });
      assert.equal(partial.statusCode, 200);
      assert.deepEqual(record.workingDays, ["tue"]);
      assert.equal(record.timeZone, "Asia/Tokyo");
      const invalid = await app.inject({ method: "PATCH", url: "/api/v1/salons/salon-1", headers, payload: { workingDays: ["invalid"] } });
      assert.equal(invalid.statusCode, 400);
      const publicResponse = await app.inject({ method: "GET", url: "/api/v1/salons" });
      assert.equal(publicResponse.statusCode, 200);
      const salon = publicResponse.json().salons[0];
      assert.deepEqual(salon.workingDays, ["tue"]);
      assert.equal(salon.timeZone, "Asia/Tokyo");
      assert.equal(salon.closingTime, "20:00");
      assert.equal(getSalonOperatingState(salon, { now: new Date("2026-09-08T10:59:00Z") }).key, "open");
      assert.equal(getSalonOperatingState(salon, { now: new Date("2026-09-08T11:00:00Z") }).key, "closed");
      assert.equal(publicResponse.json().salons.length, 1);
    } finally { await app.close(); }
  });
}
