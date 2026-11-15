import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import Fastify from "fastify";

import { signAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { loyaltyRoutes } from "./loyalty.js";

process.env.JWT_ACCESS_SECRET = "loyalty-security-test-secret";

const mock = prisma as any;
const original = {
  user: mock.user,
  salon: mock.salon,
  loyaltyCard: mock.loyaltyCard,
};

const SALON_ID = "salon-1";
const OWNER_ID = "owner-1";
const OTHER_OWNER_ID = "owner-2";
const ADMIN_ID = "admin-1";
const CUSTOMER_ID = "customer-1";

const roster = [
  {
    id: "lc-1",
    customerId: CUSTOMER_ID,
    currentStamps: 3,
    totalVisits: 3,
    lastStampedAt: new Date("2026-01-05T00:00:00Z"),
    rewardRedeemedAt: null,
    customer: { id: CUSTOMER_ID, fullName: "Fixture Person", email: "fixture.person@example.test", phone: "+4915112345678" },
  },
];

function auth(role: string, userId: string) {
  return { authorization: `Bearer ${signAccessToken({ sub: userId, role })}` };
}

beforeEach(() => {
  mock.user = {
    findUnique: async ({ where }: any) => {
      const known: Record<string, string> = {
        [OWNER_ID]: "OWNER",
        [OTHER_OWNER_ID]: "OWNER",
        [ADMIN_ID]: "ADMIN",
        [CUSTOMER_ID]: "CUSTOMER",
      };
      const role = known[where.id];
      return role ? { id: where.id, role, status: "ACTIVE" } : null;
    },
  };
  mock.salon = {
    findUnique: async ({ where }: any) => (where.id === SALON_ID ? { ownerId: OWNER_ID } : null),
  };
  mock.loyaltyCard = {
    findFirst: async ({ include }: any) => ({
      id: "card-1",
      salonId: SALON_ID,
      requiredStamps: 8,
      rewardTitle: "Free haircut",
      rewardText: "Free haircut",
      description: null,
      isActive: true,
      rewardType: "FREE_SERVICE",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      stamps: [{ id: "s1", customerId: CUSTOMER_ID, stampAt: new Date(), isValid: true }],
      customers: include?.customers ? roster.map(r=>({...r,customer:{id:r.customer.id,fullName:r.customer.fullName}})) : undefined,
    }),
  };
});

afterEach(() => Object.assign(mock, original));

async function readCard(headers?: Record<string, string>) {
  const app = Fastify();
  await loyaltyRoutes(app);
  try {
    const response = await app.inject({ url: `/api/v1/loyalty/cards/${SALON_ID}`, headers });
    return response;
  } finally {
    await app.close();
  }
}

test("loyalty roster with customer PII is hidden from anonymous callers", async () => {
  const response = await readCard();
  assert.equal(response.statusCode, 200);
  const card = response.json().card;
  assert.equal(card.id, "card-1");
  assert.equal(card.rewardTitle, "Free haircut");
  assert.equal(Object.prototype.hasOwnProperty.call(card, "customers"), false);
  assert.equal(response.body.includes("fixture.person@example.test"), false);
  assert.equal(response.body.includes("Fixture Person"), false);
  assert.equal(response.body.includes("+4915112345678"), false);
});

test("loyalty roster with customer PII is hidden from authenticated customers", async () => {
  const response = await readCard(auth("CUSTOMER", CUSTOMER_ID));
  assert.equal(response.statusCode, 200);
  const card = response.json().card;
  assert.equal(Object.prototype.hasOwnProperty.call(card, "customers"), false);
  assert.equal(response.body.includes("fixture.person@example.test"), false);
});

test("loyalty roster with customer PII is hidden from a non-owner owner", async () => {
  const response = await readCard(auth("OWNER", OTHER_OWNER_ID));
  assert.equal(response.statusCode, 200);
  assert.equal(Object.prototype.hasOwnProperty.call(response.json().card, "customers"), false);
  assert.equal(response.body.includes("fixture.person@example.test"), false);
});

test("loyalty roster stays available to the salon owner", async () => {
  const response = await readCard(auth("OWNER", OWNER_ID));
  assert.equal(response.statusCode, 200);
  const card = response.json().card;
  assert.equal(card.customers.length, 1);
  assert.equal(card.customers[0].customer.fullName, "Fixture Person");
  assert.equal(card.customers[0].customer.email, undefined);
  assert.equal(card.totalStamps, 1);
});

test("loyalty roster stays available to an admin", async () => {
  const response = await readCard(auth("ADMIN", ADMIN_ID));
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().card.customers.length, 1);
});
