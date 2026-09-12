import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import Fastify from "fastify";

import { signAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { dashboardRoutes } from "./dashboard.js";
import { salonRoutes } from "./salons.js";

const originalPrisma = {
  user: prisma.user,
  userSubscription: prisma.userSubscription,
  salon: prisma.salon,
  $transaction: prisma.$transaction.bind(prisma),
};
const prismaMock = prisma as unknown as {
  user: any;
  userSubscription: any;
  salon: any;
  $transaction: any;
};

const intakeFlags = {
  bookingIntakeEnabled: true,
  saloTicketIntakeEnabled: false,
  walkInIntakeEnabled: true,
};

function auth(role: string, userId: string) {
  return { authorization: `Bearer ${signAccessToken({ sub: userId, role })}` };
}

async function withApp(routes: (app: any) => Promise<void>, run: (app: any) => Promise<void>) {
  const app = Fastify();
  try {
    await routes(app);
    await run(app);
  } finally {
    await app.close();
  }
}

beforeEach(() => {
  process.env.JWT_ACCESS_SECRET = "trust-boundary-test-secret";
});

afterEach(() => {
  Object.assign(prisma, originalPrisma);
});

// ---------------------------------------------------------------------------
// A. UNSAFE OWNER SELF-ESCALATION BOUNDARY
// ---------------------------------------------------------------------------

for (const [name, payload] of [
  ["SMART + ACTIVE", { plan: "SMART", status: "ACTIVE" }],
  ["PREMIUM + ACTIVE", { plan: "PREMIUM", status: "ACTIVE" }],
  ["PRO + ACTIVE", { plan: "PRO", status: "ACTIVE" }],
] as const) {
  test(`A. OWNER cannot self-escalate to ${name} via POST /api/v1/subscriptions/me`, async () => {
    let written: any;
    prismaMock.user = { findUnique: async () => ({ id: "owner-a", role: "OWNER", status: "ACTIVE" }) };
    prismaMock.userSubscription = {
      findUnique: async () => null,
      upsert: async (args: any) => {
        written = args;
        return { ...args.create, id: "sub-1" };
      },
    };

    await withApp(dashboardRoutes, async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/subscriptions/me",
        headers: auth("OWNER", "owner-a"),
        payload,
      });

      assert.equal(response.statusCode, 403, response.body);
      assert.equal(written, undefined, "No subscription row should be written on self-escalation");
    });
  });
}

// ---------------------------------------------------------------------------
// B. CENTRAL OWNER ENTITLEMENT RULE FOR INTAKE CONTROLS
// ---------------------------------------------------------------------------

function setupSalon(salonId: string, ownerId: string) {
  const salons: Record<string, any> = {
    [salonId]: { id: salonId, ownerId, ...intakeFlags },
  };
  prismaMock.salon = {
    findUnique: async (args: any) => salons[args.where.id] ?? null,
    update: async (args: any) => {
      salons[args.where.id] = { ...salons[args.where.id], ...args.data };
      return salons[args.where.id];
    },
  };
  prismaMock.$transaction = async (callback: any) =>
    callback({
      user: prismaMock.user,
      salon: prismaMock.salon,
    });
  return salons;
}

function entitlementDb(entitlement: "NONE" | "FREE" | "SMART" | "PREMIUM" | "PRO") {
  const planByEntitlement: Record<typeof entitlement, string> = {
    NONE: "FREE",
    FREE: "FREE",
    SMART: "SMART",
    PREMIUM: "PREMIUM",
    PRO: "PRO",
  };
  prismaMock.user = {
    findUnique: async ({ where }: any) => ({
      id: where.id,
      role: where.id === "admin" ? "ADMIN" : where.id === "customer" ? "CUSTOMER" : "OWNER",
      status: "ACTIVE",
    }),
  };
  prismaMock.userSubscription = {
    findUnique: async ({ where }: any) => {
      if (entitlement === "NONE") return null;
      return {
        id: `sub-${where.userId}`,
        userId: where.userId,
        plan: planByEntitlement[entitlement],
        status: "ACTIVE",
        providerReference: entitlement === "FREE" ? null : `provider-${entitlement.toLowerCase()}`,
      };
    },
  };
}

for (const entitlement of ["NONE", "FREE"] as const) {
  for (const method of ["GET", "PATCH"] as const) {
    test(`B1. OWNER with ${entitlement} entitlement: ${method} Intake Controls is denied`, async () => {
      setupSalon("salon-a", "owner-a");
      entitlementDb(entitlement);

      await withApp(salonRoutes, async (app) => {
        const response = await app.inject({
          method,
          url: "/api/v1/salons/salon-a/intake-controls",
          headers: auth("OWNER", "owner-a"),
          ...(method === "PATCH" ? { payload: { bookingIntakeEnabled: false } } : {}),
        });
        assert.equal(response.statusCode, 403, response.body);
      });
    });
  }
}

for (const entitlement of ["SMART", "PREMIUM", "PRO"] as const) {
  for (const method of ["GET", "PATCH"] as const) {
    test(`B2. OWNER with ${entitlement} entitlement: ${method} Intake Controls is allowed`, async () => {
      setupSalon("salon-a", "owner-a");
      entitlementDb(entitlement);

      await withApp(salonRoutes, async (app) => {
        const response = await app.inject({
          method,
          url: "/api/v1/salons/salon-a/intake-controls",
          headers: auth("OWNER", "owner-a"),
          ...(method === "PATCH" ? { payload: { bookingIntakeEnabled: false } } : {}),
        });
        assert.equal(response.statusCode, 200, response.body);
      });
    });
  }
}

for (const method of ["GET", "PATCH"] as const) {
  test(`B3. ADMIN: ${method} Intake Controls is allowed independently of Owner subscription`, async () => {
    setupSalon("salon-a", "owner-a");
    entitlementDb("NONE");

    await withApp(salonRoutes, async (app) => {
      const response = await app.inject({
        method,
        url: "/api/v1/salons/salon-a/intake-controls",
        headers: auth("ADMIN", "admin"),
        ...(method === "PATCH" ? { payload: { bookingIntakeEnabled: false } } : {}),
      });
      assert.equal(response.statusCode, 200, response.body);
    });
  });
}

for (const method of ["GET", "PATCH"] as const) {
  test(`B4. CUSTOMER: ${method} Intake Controls is forbidden`, async () => {
    setupSalon("salon-a", "owner-a");
    entitlementDb("NONE");

    await withApp(salonRoutes, async (app) => {
      const response = await app.inject({
        method,
        url: "/api/v1/salons/salon-a/intake-controls",
        headers: auth("CUSTOMER", "customer"),
        ...(method === "PATCH" ? { payload: { bookingIntakeEnabled: false } } : {}),
      });
      assert.equal(response.statusCode, 403, response.body);
    });
  });
}

test("B5. Basic Owner Salon Edit remains available without paid entitlement", async () => {
  setupSalon("salon-a", "owner-a");
  entitlementDb("NONE");

  await withApp(salonRoutes, async (app) => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/salons/salon-a",
      headers: auth("OWNER", "owner-a"),
      payload: { name: "Renamed Salon" },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().salon.name, "Renamed Salon");
  });
});