import assert from "node:assert/strict";
import test from "node:test";

import {
  effectiveStaffMembershipSelect,
  resolveEffectiveStaffAccess,
} from "./staff-membership.js";

const activeMembership = {
  id: "membership-1",
  userId: "staff-1",
  salonId: "salon-1",
  barberId: "barber-1",
  status: "ACTIVE",
  revokedAt: null,
  user: { id: "staff-1", role: "STAFF", status: "ACTIVE" },
  salon: { id: "salon-1" },
  barber: { id: "barber-1", salonId: "salon-1" },
};

function readerReturning(memberships: typeof activeMembership[]) {
  let query: any;
  return {
    db: {
      staffMembership: {
        findMany: async (args: unknown) => {
          query = args;
          return memberships;
        },
      },
    },
    getQuery: () => query,
  };
}

test("resolves one active persisted STAFF membership for the requested salon", async () => {
  const reader = readerReturning([activeMembership]);
  const membership = await resolveEffectiveStaffAccess(reader.db, "staff-1", "salon-1");

  assert.equal(membership?.id, "membership-1");
  assert.deepEqual(reader.getQuery(), {
    where: { userId: "staff-1", salonId: "salon-1" },
    select: effectiveStaffMembershipSelect,
    take: 2,
  });
});

test("rejects cross-salon membership data", async () => {
  const reader = readerReturning([{
    ...activeMembership,
    salonId: "salon-2",
    salon: { id: "salon-2" },
    barber: { id: "barber-1", salonId: "salon-2" },
  }]);

  assert.equal(await resolveEffectiveStaffAccess(reader.db, "staff-1", "salon-1"), null);
});

test("rejects a barber persisted under a different salon", async () => {
  const reader = readerReturning([{
    ...activeMembership,
    barber: { id: "barber-1", salonId: "salon-2" },
  }]);

  assert.equal(await resolveEffectiveStaffAccess(reader.db, "staff-1", "salon-1"), null);
});

test("fails closed when duplicate memberships are returned", async () => {
  const reader = readerReturning([
    activeMembership,
    { ...activeMembership, id: "membership-2", barberId: "barber-2", barber: { id: "barber-2", salonId: "salon-1" } },
  ]);

  assert.equal(await resolveEffectiveStaffAccess(reader.db, "staff-1", "salon-1"), null);
});

for (const status of ["SUSPENDED", "REVOKED"]) {
  test(`rejects a ${status.toLowerCase()} membership`, async () => {
    const reader = readerReturning([{ ...activeMembership, status }]);
    assert.equal(await resolveEffectiveStaffAccess(reader.db, "staff-1", "salon-1"), null);
  });
}

test("rejects a membership carrying a revocation timestamp", async () => {
  const reader = readerReturning([{ ...activeMembership, revokedAt: new Date() }]);
  assert.equal(await resolveEffectiveStaffAccess(reader.db, "staff-1", "salon-1"), null);
});

for (const status of ["INACTIVE", "SUSPENDED", "DELETED"]) {
  test(`rejects a ${status.toLowerCase()} user`, async () => {
    const reader = readerReturning([{
      ...activeMembership,
      user: { ...activeMembership.user, status },
    }]);
    assert.equal(await resolveEffectiveStaffAccess(reader.db, "staff-1", "salon-1"), null);
  });
}

for (const role of ["CUSTOMER", "OWNER", "ADMIN"]) {
  test(`rejects a persisted ${role} user`, async () => {
    const reader = readerReturning([{
      ...activeMembership,
      user: { ...activeMembership.user, role },
    }]);
    assert.equal(await resolveEffectiveStaffAccess(reader.db, "staff-1", "salon-1"), null);
  });
}