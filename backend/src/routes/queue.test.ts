import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Fastify from "fastify";

import { prisma } from "../lib/prisma.js";
import { signAccessToken } from "../lib/jwt.js";
import { queueRoutes } from "./queue.js";
process.env.JWT_ACCESS_SECRET = "test-access-secret";
const originalQueueEntry = (prisma as any).queueEntry;
const originalSalon = prisma.salon;
const originalUser = prisma.user;
const originalStaffMembership = (prisma as any).staffMembership;
const originalServiceVisit = (prisma as any).serviceVisit;
const originalTransaction = prisma.$transaction.bind(prisma);

afterEach(() => {
  (prisma as any).queueEntry = originalQueueEntry;
  (prisma as any).salon = originalSalon;
  (prisma as any).user = originalUser;
  (prisma as any).staffMembership = originalStaffMembership;
  (prisma as any).serviceVisit = originalServiceVisit;
  (prisma as any).$transaction = originalTransaction;
});

const customer = {
  id: "customer-1",
  role: "CUSTOMER",
  status: "ACTIVE",
};

const activeTicket = {
  id: "11111111-1111-4111-8111-111111111111",
  salonId: "22222222-2222-4222-8222-222222222222",
  customerId: customer.id,
  serviceVisitId: null,
  source: "SALO_TICKET",
  status: "WAITING",
  joinedAt: new Date("2026-09-10T12:00:00Z"),
  calledAt: null,
  startedAt: null,
  cancelledAt: null,
  expiredAt: null,
  noShowAt: null,
  version: 1,
  createdAt: new Date("2026-09-10T12:00:00Z"),
  updatedAt: new Date("2026-09-10T12:00:00Z"),
};

function mockAuthenticatedCustomer() {
  (prisma as any).user = {
    findUnique: async () => customer,
  };
}

test("customer creates a SALO Ticket in WAITING", async () => {
  mockAuthenticatedCustomer();

  (prisma as any).salon = {
  findUnique: async () => ({
    id: activeTicket.salonId,
    saloTicketIntakeEnabled: true,
  }),
};

  (prisma as any).queueEntry = {
    findFirst: async () => null,
    create: async (args: any) => {
      assert.equal(args.data.salonId, activeTicket.salonId);
      assert.equal(args.data.customerId, customer.id);
      assert.equal(args.data.source, "SALO_TICKET");
      assert.equal(args.data.status, "WAITING");
      assert.ok(args.data.joinedAt instanceof Date);
      return activeTicket;
    },
  };

  const app = Fastify();
  await queueRoutes(app);

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/salons/${activeTicket.salonId}/queue/tickets`,
      headers: {
  authorization: `Bearer ${signAccessToken({
    sub: customer.id,
    role: "CUSTOMER",
  })}`,
},
    });

    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().created, true);
    assert.equal(response.json().queueEntry.id, activeTicket.id);
  } finally {
    await app.close();
  }
});
test("customer cannot create a new SALO Ticket when ticket intake is disabled", async () => {
  mockAuthenticatedCustomer();

  (prisma as any).salon = {
    findUnique: async () => ({
      id: activeTicket.salonId,
      saloTicketIntakeEnabled: false,
    }),
  };

  let createCalled = false;

  (prisma as any).queueEntry = {
    findFirst: async () => null,
    create: async () => {
      createCalled = true;
      return activeTicket;
    },
  };

  const app = Fastify();
  await queueRoutes(app);

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/salons/${activeTicket.salonId}/queue/tickets`,
      headers: {
        authorization: `Bearer ${signAccessToken({
          sub: customer.id,
          role: "CUSTOMER",
        })}`,
      },
    });

    assert.equal(response.statusCode, 409, response.body);
    assert.deepEqual(response.json(), {
      error: "SALO Ticket intake is currently disabled",
    });
    assert.equal(createCalled, false);
  } finally {
    await app.close();
  }
});
test("repeated ticket request returns existing active SALO Ticket", async () => {
  mockAuthenticatedCustomer();

  (prisma as any).salon = {
    findUnique: async () => ({ id: activeTicket.salonId, saloTicketIntakeEnabled: false }),
  };

  let createCalled = false;

  (prisma as any).queueEntry = {
    findFirst: async (args: any) => {
      assert.equal(args.where.customerId, customer.id);
      assert.equal(args.where.source, "SALO_TICKET");
      assert.deepEqual(args.where.status.in, ["WAITING", "CALLED"]);
      return activeTicket;
    },
    create: async () => {
      createCalled = true;
      return activeTicket;
    },
  };

  const app = Fastify();
  await queueRoutes(app);

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/salons/${activeTicket.salonId}/queue/tickets`,
     headers: {
  authorization: `Bearer ${signAccessToken({
    sub: customer.id,
    role: "CUSTOMER",
  })}`,
},
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().created, false);
    assert.equal(response.json().queueEntry.id, activeTicket.id);
    assert.equal(createCalled, false);
  } finally {
    await app.close();
  }
});

test("customer cannot cancel another customer's ticket", async () => {
  mockAuthenticatedCustomer();

  (prisma as any).queueEntry = {
    findUnique: async () => ({
      ...activeTicket,
      customerId: "another-customer",
    }),
  };

  const app = Fastify();
  await queueRoutes(app);

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/salons/${activeTicket.salonId}/queue/${activeTicket.id}/cancel`,
      headers: {
  authorization: `Bearer ${signAccessToken({
    sub: customer.id,
    role: "CUSTOMER",
  })}`,
},
    });

    assert.equal(response.statusCode, 403, response.body);
  } finally {
    await app.close();
  }
});

test("customer cancels own active SALO Ticket with optimistic version check", async () => {
  mockAuthenticatedCustomer();

  let updateArgs: any;

  (prisma as any).queueEntry = {
    findUnique: async () => activeTicket,
    updateMany: async (args: any) => {
      updateArgs = args;
      return { count: 1 };
    },
  };

  const cancelledTicket = {
    ...activeTicket,
    status: "CANCELLED",
    cancelledAt: new Date("2026-09-10T12:05:00Z"),
    version: 2,
  };

  let reads = 0;
  (prisma as any).queueEntry.findUnique = async () => {
    reads += 1;
    return reads === 1 ? activeTicket : cancelledTicket;
  };

  const app = Fastify();
  await queueRoutes(app);

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/salons/${activeTicket.salonId}/queue/${activeTicket.id}/cancel`,
      headers: {
  authorization: `Bearer ${signAccessToken({
    sub: customer.id,
    role: "CUSTOMER",
  })}`,
},
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(updateArgs.where.id, activeTicket.id);
    assert.equal(updateArgs.where.version, 1);
    assert.equal(updateArgs.where.status, "WAITING");
    assert.equal(updateArgs.data.status, "CANCELLED");
    assert.deepEqual(updateArgs.data.version, { increment: 1 });
    assert.ok(updateArgs.data.cancelledAt instanceof Date);
    assert.equal(response.json().queueEntry.status, "CANCELLED");
  } finally {
    await app.close();
  }
});

test("cancel returns conflict when queue entry changed concurrently", async () => {
  mockAuthenticatedCustomer();

  (prisma as any).queueEntry = {
    findUnique: async () => activeTicket,
    updateMany: async () => ({ count: 0 }),
  };

  const app = Fastify();
  await queueRoutes(app);

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/salons/${activeTicket.salonId}/queue/${activeTicket.id}/cancel`,
    headers: {
  authorization: `Bearer ${signAccessToken({
    sub: customer.id,
    role: "CUSTOMER",
  })}`,
},
    });

    assert.equal(response.statusCode, 409, response.body);
  } finally {
    await app.close();
  }
});

test("owner starts a waiting queue entry and creates WALK_IN service visit atomically", async () => {
  const owner = { id: "owner-1", role: "OWNER", status: "ACTIVE" };
  const membershipId = "44444444-4444-4444-8444-444444444444";
  const visitId = "33333333-3333-4333-8333-333333333333";
  const now = Date.now();
  let visitData: any;
  let updateArgs: any;
  let reads = 0;

  (prisma as any).user = {
    findUnique: async () => owner,
  };
  (prisma as any).salon = {
    findUnique: async () => ({ id: activeTicket.salonId, ownerId: owner.id }),
  };

  const tx = {
    queueEntry: {
      findUnique: async () => {
        reads += 1;
        return reads === 1 ? activeTicket : {
          ...activeTicket,
          ...updateArgs.data,
          version: activeTicket.version + 1,
        };
      },
      updateMany: async (args: any) => {
        updateArgs = args;
        return { count: 1 };
      },
    },
    staffMembership: {
      findUnique: async () => ({
        id: membershipId,
        salonId: activeTicket.salonId,
        status: "ACTIVE",
        revokedAt: null,
        presence: {
          staffMembershipId: membershipId,
          dutyState: "ON_DUTY",
          generation: 1,
          leases: [{
            staffMembershipId: membershipId,
            generation: 1,
            revokedAt: null,
            observedAt: new Date(now - 60_000),
            validUntil: new Date(now + 3_600_000),
          }],
        },
      }),
    },
    serviceVisit: {
      create: async (args: any) => {
        visitData = args.data;
        return { ...args.data, id: visitId };
      },
    },
  };
  (prisma as any).$transaction = async (callback: (tx: any) => Promise<any>) => callback(tx);

  const app = Fastify();
  await queueRoutes(app);

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/salons/${activeTicket.salonId}/queue/${activeTicket.id}/start`,
      headers: {
        authorization: `Bearer ${signAccessToken({
          sub: owner.id,
          role: "OWNER",
        })}`,
      },
      payload: { staffMembershipId: membershipId },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(visitData.source, "WALK_IN");
    assert.equal(visitData.status, "IN_SERVICE");
    assert.equal(visitData.salonId, activeTicket.salonId);
    assert.equal(visitData.bookingId, null);
    assert.equal(visitData.staffMembershipId, membershipId);
    assert.equal(visitData.startedByUserId, owner.id);
    assert.equal(updateArgs.data.status, "STARTED");
    assert.equal(updateArgs.data.serviceVisitId, visitId);
    assert.deepEqual(updateArgs.data.version, { increment: 1 });
    assert.ok(updateArgs.data.startedAt instanceof Date);
    assert.equal(updateArgs.where.id, activeTicket.id);
    assert.equal(updateArgs.where.version, 1);
    assert.equal(updateArgs.where.status, "WAITING");
  } finally {
    await app.close();
  }
});

test("owner cannot start a queue entry for another salon", async () => {
  const owner = { id: "owner-2", role: "OWNER", status: "ACTIVE" };
  let transactionCalls = 0;

  (prisma as any).user = {
    findUnique: async () => owner,
  };
  (prisma as any).salon = {
    findUnique: async () => ({
      id: activeTicket.salonId,
      ownerId: "different-owner-id",
    }),
  };
  (prisma as any).$transaction = async () => {
    transactionCalls += 1;
    throw new Error("Transaction must not be called for another salon's owner");
  };

  const app = Fastify();
  await queueRoutes(app);

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/salons/${activeTicket.salonId}/queue/${activeTicket.id}/start`,
      headers: {
        authorization: `Bearer ${signAccessToken({
          sub: owner.id,
          role: "OWNER",
        })}`,
      },
      payload: { staffMembershipId: "44444444-4444-4444-8444-444444444444" },
    });

    assert.equal(response.statusCode, 403, response.body);
    assert.equal(transactionCalls, 0);
  } finally {
    await app.close();
  }
});

test("owner cannot start a queue entry when staff presence is not confirmed", async () => {
  const owner = { id: "owner-1", role: "OWNER", status: "ACTIVE" };
  const membershipId = "44444444-4444-4444-8444-444444444444";
  let serviceVisitCreated = false;

  (prisma as any).user = {
    findUnique: async () => owner,
  };
  (prisma as any).salon = {
    findUnique: async () => ({ id: activeTicket.salonId, ownerId: owner.id }),
  };

  const tx = {
    queueEntry: {
      findUnique: async () => activeTicket,
    },
    staffMembership: {
      findUnique: async () => ({
        id: membershipId,
        salonId: activeTicket.salonId,
        status: "ACTIVE",
        revokedAt: null,
        presence: {
          staffMembershipId: membershipId,
          dutyState: "ON_DUTY",
          generation: 1,
          leases: [],
        },
      }),
    },
    serviceVisit: {
      create: async () => {
        serviceVisitCreated = true;
        return { id: "33333333-3333-4333-8333-333333333333" };
      },
    },
  };
  (prisma as any).$transaction = async (callback: (tx: any) => Promise<any>) => callback(tx);

  const app = Fastify();
  await queueRoutes(app);

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/salons/${activeTicket.salonId}/queue/${activeTicket.id}/start`,
      headers: {
        authorization: `Bearer ${signAccessToken({
          sub: owner.id,
          role: "OWNER",
        })}`,
      },
      payload: { staffMembershipId: membershipId },
    });

    assert.equal(response.statusCode, 409, response.body);
    assert.equal(serviceVisitCreated, false);
  } finally {
    await app.close();
  }
});

test("start returns conflict when queue entry changes concurrently", async () => {
  const owner = { id: "owner-1", role: "OWNER", status: "ACTIVE" };
  const membershipId = "44444444-4444-4444-8444-444444444444";
  const now = Date.now();

  (prisma as any).user = {
    findUnique: async () => owner,
  };
  (prisma as any).salon = {
    findUnique: async () => ({ id: activeTicket.salonId, ownerId: owner.id }),
  };

  const tx = {
    queueEntry: {
      findUnique: async () => activeTicket,
      updateMany: async () => ({ count: 0 }),
    },
    staffMembership: {
      findUnique: async () => ({
        id: membershipId,
        salonId: activeTicket.salonId,
        status: "ACTIVE",
        revokedAt: null,
        presence: {
          staffMembershipId: membershipId,
          dutyState: "ON_DUTY",
          generation: 1,
          leases: [{
            staffMembershipId: membershipId,
            generation: 1,
            revokedAt: null,
            observedAt: new Date(now - 60_000),
            validUntil: new Date(now + 3_600_000),
          }],
        },
      }),
    },
    serviceVisit: {
      create: async (args: any) => ({
        ...args.data,
        id: "33333333-3333-4333-8333-333333333333",
        source: "WALK_IN",
        status: "IN_SERVICE",
      }),
    },
  };
  (prisma as any).$transaction = async (callback: (tx: any) => Promise<any>) => callback(tx);

  const app = Fastify();
  await queueRoutes(app);

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/salons/${activeTicket.salonId}/queue/${activeTicket.id}/start`,
      headers: {
        authorization: `Bearer ${signAccessToken({
          sub: owner.id,
          role: "OWNER",
        })}`,
      },
      payload: { staffMembershipId: membershipId },
    });

    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().error, "Queue entry changed");
  } finally {
    await app.close();
  }
});

test("owner cannot start a queue entry from a terminal status", async () => {
  const owner = { id: "owner-1", role: "OWNER", status: "ACTIVE" };
  const membershipId = "44444444-4444-4444-8444-444444444444";
  let staffMembershipCalled = false;
  let serviceVisitCreated = false;

  (prisma as any).user = {
    findUnique: async () => owner,
  };
  (prisma as any).salon = {
    findUnique: async () => ({ id: activeTicket.salonId, ownerId: owner.id }),
  };

  const tx = {
    queueEntry: {
      findUnique: async () => ({
        ...activeTicket,
        status: "CANCELLED",
        cancelledAt: new Date(),
      }),
    },
    staffMembership: {
      findUnique: async () => {
        staffMembershipCalled = true;
        return null;
      },
    },
    serviceVisit: {
      create: async () => {
        serviceVisitCreated = true;
        return { id: "33333333-3333-4333-8333-333333333333" };
      },
    },
  };
  (prisma as any).$transaction = async (callback: (tx: any) => Promise<any>) => callback(tx);

  const app = Fastify();
  await queueRoutes(app);

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/salons/${activeTicket.salonId}/queue/${activeTicket.id}/start`,
      headers: {
        authorization: `Bearer ${signAccessToken({
          sub: owner.id,
          role: "OWNER",
        })}`,
      },
      payload: { staffMembershipId: membershipId },
    });

    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().error, "Invalid queue transition");
    assert.equal(staffMembershipCalled, false);
    assert.equal(serviceVisitCreated, false);
  } finally {
    await app.close();
  }
});
