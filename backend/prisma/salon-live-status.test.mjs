import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("./schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/20260909120000_salon_live_status/migration.sql", import.meta.url), "utf8");
const model = (name) => {
  const match = schema.match(new RegExp(`model ${name} \\{([^}]+)\\}`));
  assert.ok(match, `Missing ${name} model`);
  return match[1];
};
const liveStatus = model("SalonLiveStatus");

test("live status is optional on Salon and uniquely owned through its primary key", () => {
  assert.match(model("Salon"), /^\s+liveStatus\s+SalonLiveStatus\?\s*$/m);
  assert.match(liveStatus, /^\s+salonId\s+String\s+@id\s*$/m);
  assert.match(liveStatus, /salon\s+Salon\s+@relation\(fields: \[salonId\], references: \[id\], onDelete: Cascade\)/);
  assert.match(migration, /PRIMARY KEY \("salonId"\)/);
  assert.match(migration, /FOREIGN KEY \("salonId"\) REFERENCES "Salon"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE/);
});

test("only the minimal fields are stored and unknown live facts have no defaults", () => {
  assert.deepEqual(liveStatus.trim().split(/\r?\n/).map((line) => line.trim().split(/\s+/)[0]), [
    "salonId", "operationalState", "observedAt", "expiresAt", "source", "createdAt", "updatedAt", "salon",
  ]);
  for (const [field, type, sqlType] of [
    ["operationalState", "String", "TEXT"],
    ["observedAt", "DateTime", "TIMESTAMP(3)"],
    ["expiresAt", "DateTime", "TIMESTAMP(3)"],
    ["source", "String", "TEXT"],
  ]) {
    assert.match(liveStatus, new RegExp(`^\\s+${field}\\s+${type}\\?\\s*$`, "m"));
    assert.equal(migration.split(/\r?\n/).find((line) => line.trim().startsWith(`"${field}"`))?.trim(), `"${field}" ${sqlType},`);
  }
});

test("audit timestamps are separate from nullable observation and expiry timestamps", () => {
  assert.match(liveStatus, /createdAt\s+DateTime\s+@default\(now\(\)\)/);
  assert.match(liveStatus, /updatedAt\s+DateTime\s+@updatedAt/);
  assert.match(migration, /"createdAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.match(migration, /"updatedAt" TIMESTAMP\(3\) NOT NULL,/);
});

test("migration only adds live status storage without backfilling or changing Salon", () => {
  const statements = migration.replace(/--[^\n]*/g, "").split(";").map((s) => s.trim()).filter(Boolean);
  assert.equal(statements.length, 2);
  assert.ok(statements[0].startsWith('CREATE TABLE "SalonLiveStatus" ('));
  assert.ok(statements[1].startsWith('ALTER TABLE "SalonLiveStatus" ADD CONSTRAINT'));
  assert.deepEqual([...statements[0].matchAll(/^\s+"(\w+)" /gm)].map((match) => match[1]), [
    "salonId", "operationalState", "observedAt", "expiresAt", "source", "createdAt", "updatedAt",
  ]);
});
