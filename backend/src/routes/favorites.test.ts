import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import Fastify from "fastify";

import { signAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { favoriteRoutes } from "./favorites.js";

const original = {
  user: prisma.user,
  salon: prisma.salon,
  customerFavorite: prisma.customerFavorite,
};
const mock = prisma as any;

interface SalonRow { id: string; isActive: boolean; name: string; city: string; ownerId: string }

let salons = new Map<string, SalonRow>();
let favorites = new Map<string, { id: string; userId: string; salonId: string; createdAt: Date }>();
let favoriteSeq = 0;

const ACTIVE_SALON = "aaaaaaaa-1111-4111-8111-111111111111";
const INACTIVE_SALON = "bbbbbbbb-2222-4222-8222-222222222222";
const MISSING_SALON = "cccccccc-3333-4333-8333-333333333333";
const CUSTOMER_A = "customer-a";
const CUSTOMER_B = "customer-b";

const favoriteKey = (userId: string, salonId: string) => `${userId}|${salonId}`;

beforeEach(() => {
  process.env.JWT_ACCESS_SECRET = "favorites-route-test-secret";
  salons = new Map([
    [ACTIVE_SALON, { id: ACTIVE_SALON, isActive: true, name: "Active Salon", city: "Berlin", ownerId: "owner-1" }],
    [INACTIVE_SALON, { id: INACTIVE_SALON, isActive: false, name: "Archived Salon", city: "Köln", ownerId: "owner-1" }],
  ]);
  favorites = new Map();
  favoriteSeq = 0;

  const project = (row: any, select: any) => {
    if (!select) return row;
    return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]));
  };

  mock.user = {
    findUnique: async ({ where }: any) =>
      where.id === "missing-user" ? null : { id: where.id, role: mock.__role, status: "ACTIVE" },
  };
  mock.salon = {
    findFirst: async ({ where, select }: any) => {
      const salon = salons.get(where.id);
      if (!salon) return null;
      if (where.isActive === true && !salon.isActive) return null;
      return project({ ...salon, media: [] }, select);
    },
  };
  mock.customerFavorite = {
    findMany: async ({ where, include }: any) => {
      const rows = [...favorites.values()].filter((row) => {
        if (row.userId !== where.userId) return false;
        const salon = salons.get(row.salonId);
        if (where.salon?.isActive === true && !salon?.isActive) return false;
        return true;
      });
      return rows.map((row) => {
        const salonRow = { ...salons.get(row.salonId)!, media: [] };
        const salonSelect = include?.salon?.select;
        return { ...row, salon: salonSelect ? project(salonRow, salonSelect) : salonRow };
      });
    },
    findFirst: async ({ where }: any) => {
      const row = favorites.get(favoriteKey(where.userId, where.salonId));
      if (!row) return null;
      if (where.salon?.isActive === true && !salons.get(row.salonId)?.isActive) return null;
      return { id: row.id };
    },
    upsert: async ({ where, create }: any) => {
      const key = favoriteKey(create.userId, create.salonId);
      let row = favorites.get(key);
      if (!row) {
        favoriteSeq += 1;
        row = { id: `fav-${favoriteSeq}`, userId: create.userId, salonId: create.salonId, createdAt: new Date("2026-01-01T00:00:00Z") };
        favorites.set(key, row);
      }
      assert.equal(where.userId_salonId.userId, create.userId);
      assert.equal(where.userId_salonId.salonId, create.salonId);
      return { id: row.id, salonId: row.salonId, createdAt: row.createdAt };
    },
    deleteMany: async ({ where }: any) => {
      const key = favoriteKey(where.userId, where.salonId);
      const removed = favorites.delete(key);
      return { count: removed ? 1 : 0 };
    },
  };
});

afterEach(() => Object.assign(mock, original));

function auth(role: string, userId: string) {
  return { authorization: `Bearer ${signAccessToken({ sub: userId, role })}` };
}

async function withFavorites(run: (app: ReturnType<typeof Fastify>) => Promise<void>) {
  const app = Fastify();
  await favoriteRoutes(app);
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

test("GET favorites requires authentication", async () => {
  await withFavorites(async (app) => {
    const res = await app.inject({ method: "GET", url: "/api/v1/favorites" });
    assert.equal(res.statusCode, 401, res.body);
  });
});

test("POST and DELETE favorites require authentication", async () => {
  await withFavorites(async (app) => {
    const post = await app.inject({ method: "POST", url: `/api/v1/favorites/${ACTIVE_SALON}` });
    assert.equal(post.statusCode, 401, post.body);
    const remove = await app.inject({ method: "DELETE", url: `/api/v1/favorites/${ACTIVE_SALON}` });
    assert.equal(remove.statusCode, 401, remove.body);
  });
});

test("owner, staff and admin roles are forbidden", async () => {
  await withFavorites(async (app) => {
    for (const role of ["OWNER", "STAFF", "ADMIN"]) {
      mock.__role = role;
      const list = await app.inject({ method: "GET", url: "/api/v1/favorites", headers: auth(role, "someone") });
      assert.equal(list.statusCode, 403, `${role}: ${list.body}`);
      const add = await app.inject({ method: "POST", url: `/api/v1/favorites/${ACTIVE_SALON}`, headers: auth(role, "someone") });
      assert.equal(add.statusCode, 403, `${role}: ${add.body}`);
    }
  });
});

test("add favorite persists a single row and ignores spoofed ownership", async () => {
  mock.__role = "CUSTOMER";
  await withFavorites(async (app) => {
    const first = await app.inject({
      method: "POST",
      url: `/api/v1/favorites/${ACTIVE_SALON}`,
      headers: auth("CUSTOMER", CUSTOMER_A),
      payload: { userId: CUSTOMER_B },
    });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(favorites.size, 1);
    assert.equal([...favorites.values()][0].userId, CUSTOMER_A);

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/favorites/${ACTIVE_SALON}`,
      headers: auth("CUSTOMER", CUSTOMER_A),
      payload: { userId: CUSTOMER_B },
    });
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(favorites.size, 1, "duplicate favorite must not create a second row");
    assert.equal(second.json().favorite.salonId, ACTIVE_SALON);
  });
});

test("status endpoint reports favorited state for the caller only", async () => {
  mock.__role = "CUSTOMER";
  await withFavorites(async (app) => {
    const before = await app.inject({ method: "GET", url: `/api/v1/favorites/${ACTIVE_SALON}`, headers: auth("CUSTOMER", CUSTOMER_A) });
    assert.equal(before.statusCode, 200, before.body);
    assert.deepEqual(before.json(), { favorited: false, salonId: ACTIVE_SALON });

    await app.inject({ method: "POST", url: `/api/v1/favorites/${ACTIVE_SALON}`, headers: auth("CUSTOMER", CUSTOMER_A) });

    const mine = await app.inject({ method: "GET", url: `/api/v1/favorites/${ACTIVE_SALON}`, headers: auth("CUSTOMER", CUSTOMER_A) });
    assert.equal(mine.json().favorited, true);

    const other = await app.inject({ method: "GET", url: `/api/v1/favorites/${ACTIVE_SALON}`, headers: auth("CUSTOMER", CUSTOMER_B) });
    assert.equal(other.json().favorited, false, "customer B must not see customer A favorites");
  });
});

test("list returns only the caller favorites and hides inactive salons", async () => {
  mock.__role = "CUSTOMER";
  favorites.set(favoriteKey(CUSTOMER_A, ACTIVE_SALON), { id: "fav-a-active", userId: CUSTOMER_A, salonId: ACTIVE_SALON, createdAt: new Date("2026-01-02T00:00:00Z") });
  favorites.set(favoriteKey(CUSTOMER_A, INACTIVE_SALON), { id: "fav-a-inactive", userId: CUSTOMER_A, salonId: INACTIVE_SALON, createdAt: new Date("2026-01-03T00:00:00Z") });
  favorites.set(favoriteKey(CUSTOMER_B, ACTIVE_SALON), { id: "fav-b-active", userId: CUSTOMER_B, salonId: ACTIVE_SALON, createdAt: new Date("2026-01-04T00:00:00Z") });

  await withFavorites(async (app) => {
    const res = await app.inject({ method: "GET", url: "/api/v1/favorites", headers: auth("CUSTOMER", CUSTOMER_A) });
    assert.equal(res.statusCode, 200, res.body);
    const payload = res.json();
    assert.equal(payload.favorites.length, 1, "inactive salon favorites must stay hidden");
    assert.equal(payload.favorites[0].salonId, ACTIVE_SALON);
    assert.equal(payload.favorites[0].salon.name, "Active Salon");
    assert.equal(payload.favorites[0].salon.ownerId, undefined, "owner identity must not leak");
    assert.equal(payload.favorites[0].salon.email, undefined, "owner e-mail must not leak");
  });
});

test("favoriting an unavailable salon is rejected", async () => {
  mock.__role = "CUSTOMER";
  await withFavorites(async (app) => {
    const inactive = await app.inject({ method: "POST", url: `/api/v1/favorites/${INACTIVE_SALON}`, headers: auth("CUSTOMER", CUSTOMER_A) });
    assert.equal(inactive.statusCode, 404, inactive.body);

    const missing = await app.inject({ method: "POST", url: `/api/v1/favorites/${MISSING_SALON}`, headers: auth("CUSTOMER", CUSTOMER_A) });
    assert.equal(missing.statusCode, 404, missing.body);

    const whitespace = await app.inject({ method: "POST", url: "/api/v1/favorites/%20", headers: auth("CUSTOMER", CUSTOMER_A) });
    assert.equal(whitespace.statusCode, 400, whitespace.body);

    const oversized = await app.inject({ method: "POST", url: `/api/v1/favorites/${"a".repeat(130)}`, headers: auth("CUSTOMER", CUSTOMER_A) });
    assert.ok([400, 404].includes(oversized.statusCode), `unexpected ${oversized.statusCode}: ${oversized.body}`);

    assert.equal(favorites.size, 0);
  });
});

test("removing a favorite is idempotent", async () => {
  mock.__role = "CUSTOMER";
  favorites.set(favoriteKey(CUSTOMER_A, ACTIVE_SALON), { id: "fav-a-1", userId: CUSTOMER_A, salonId: ACTIVE_SALON, createdAt: new Date("2026-01-05T00:00:00Z") });

  await withFavorites(async (app) => {
    const first = await app.inject({ method: "DELETE", url: `/api/v1/favorites/${ACTIVE_SALON}`, headers: auth("CUSTOMER", CUSTOMER_A) });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().removed, true);
    assert.equal(favorites.size, 0);

    const second = await app.inject({ method: "DELETE", url: `/api/v1/favorites/${ACTIVE_SALON}`, headers: auth("CUSTOMER", CUSTOMER_A) });
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(second.json().removed, false);
    assert.equal(favorites.size, 0);
  });
});

test("customer B cannot remove customer A favorites", async () => {
  mock.__role = "CUSTOMER";
  favorites.set(favoriteKey(CUSTOMER_A, ACTIVE_SALON), { id: "fav-a-1", userId: CUSTOMER_A, salonId: ACTIVE_SALON, createdAt: new Date("2026-01-06T00:00:00Z") });

  await withFavorites(async (app) => {
    const res = await app.inject({ method: "DELETE", url: `/api/v1/favorites/${ACTIVE_SALON}`, headers: auth("CUSTOMER", CUSTOMER_B) });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().removed, false, "customer B must not delete customer A rows");
    assert.equal(favorites.size, 1);
  });
});
