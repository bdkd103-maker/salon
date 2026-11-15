import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import Fastify from "fastify";

import { prisma } from "../lib/prisma.js";
import { signAccessToken } from "../lib/jwt.js";
import { queueRoutes } from "./queue.js";
process.env.JWT_ACCESS_SECRET = "test-access-secret";
const originalSettings = prisma.platformSettings;
const originalNotification = prisma.notification;
beforeEach(() => {
  (prisma as any).platformSettings = { findUnique:async()=>({saloTicketGloballyEnabled:true,walkInGloballyEnabled:true}) };
  (prisma as any).notification = { upsert: async ({create}: any) => { assert.ok(create.userId); return create; } };
  (prisma as any).$transaction = async (fn: any) => fn(prisma);
  (prisma as any).salon = { findUniqueOrThrow: async () => ({ ownerId: "owner-1" }) };
});
const originalQueueEntry = (prisma as any).queueEntry;
const originalSalon = prisma.salon;
const originalUser = prisma.user;
const originalStaffMembership = (prisma as any).staffMembership;
const originalServiceVisit = (prisma as any).serviceVisit;
const originalService = (prisma as any).service;
const originalTransaction = prisma.$transaction.bind(prisma);

afterEach(() => {
  (prisma as any).platformSettings = originalSettings;
  (prisma as any).notification = originalNotification;
  (prisma as any).queueEntry = originalQueueEntry;
  (prisma as any).salon = originalSalon;
  (prisma as any).user = originalUser;
  (prisma as any).staffMembership = originalStaffMembership;
  (prisma as any).serviceVisit = originalServiceVisit;
  (prisma as any).service = originalService;
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
    saloTicketIntakeEnabled: true, walkInIntakeEnabled: true, isActive: true, ownerId: "owner-1",
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
    notification: (prisma as any).notification,
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
    notification: (prisma as any).notification,
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
    notification: (prisma as any).notification,
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

test("staff starts a waiting queue entry using their own active membership", async () => {
  const staff = { id: "staff-1", role: "STAFF", status: "ACTIVE" };
  const membershipId = "44444444-4444-4444-8444-444444444444";
  const visitId = "33333333-3333-4333-8333-333333333333";
  const now = Date.now();
  let visitData: any;
  let updateArgs: any;
  let reads = 0;

  (prisma as any).user = {
    findUnique: async () => staff,
  };
  (prisma as any).salon = {
    findUnique: async () => ({ id: activeTicket.salonId, ownerId: "owner-1" }),
  };

  const tx = {
    notification: (prisma as any).notification,
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
        userId: staff.id,
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
          sub: staff.id,
          role: "STAFF",
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
    assert.equal(visitData.startedByUserId, staff.id);
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

test("staff cannot start a queue entry using another employee's membership", async () => {
  const staff = { id: "staff-1", role: "STAFF", status: "ACTIVE" };
  const otherMembershipId = "55555555-5555-5555-8555-555555555555";
  let serviceVisitCreated = false;

  (prisma as any).user = {
    findUnique: async () => staff,
  };
  (prisma as any).salon = {
    findUnique: async () => ({ id: activeTicket.salonId, ownerId: "owner-1" }),
  };

  const tx = {
    notification: (prisma as any).notification,
    queueEntry: {
      findUnique: async () => activeTicket,
    },
    staffMembership: {
      findUnique: async () => ({
        id: otherMembershipId,
        userId: "staff-2",
        salonId: activeTicket.salonId,
        status: "ACTIVE",
        revokedAt: null,
        presence: {
          staffMembershipId: otherMembershipId,
          dutyState: "ON_DUTY",
          generation: 1,
          leases: [{
            staffMembershipId: otherMembershipId,
            generation: 1,
            revokedAt: null,
            observedAt: new Date(Date.now() - 60_000),
            validUntil: new Date(Date.now() + 3_600_000),
          }],
        },
      }),
    },
    serviceVisit: {
      create: async () => {
        serviceVisitCreated = true;
        return { id: "visit-1" };
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
          sub: staff.id,
          role: "STAFF",
        })}`,
      },
      payload: { staffMembershipId: otherMembershipId },
    });

    assert.equal(response.statusCode, 403, response.body);
    assert.equal(serviceVisitCreated, false);
  } finally {
    await app.close();
  }
});

test("staff cannot start a queue entry using a membership at another salon", async () => {
  const staff = { id: "staff-1", role: "STAFF", status: "ACTIVE" };
  const otherSalonMembershipId = "66666666-6666-6666-8666-666666666666";
  let serviceVisitCreated = false;

  (prisma as any).user = {
    findUnique: async () => staff,
  };
  (prisma as any).salon = {
    findUnique: async () => ({ id: activeTicket.salonId, ownerId: "owner-1" }),
  };

  const tx = {
    notification: (prisma as any).notification,
    queueEntry: {
      findUnique: async () => activeTicket,
    },
    staffMembership: {
      findUnique: async () => ({
        id: otherSalonMembershipId,
        userId: staff.id,
        salonId: "other-salon-id",
        status: "ACTIVE",
        revokedAt: null,
        presence: {
          staffMembershipId: otherSalonMembershipId,
          dutyState: "ON_DUTY",
          generation: 1,
          leases: [],
        },
      }),
    },
    serviceVisit: {
      create: async () => {
        serviceVisitCreated = true;
        return { id: "visit-1" };
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
          sub: staff.id,
          role: "STAFF",
        })}`,
      },
      payload: { staffMembershipId: otherSalonMembershipId },
    });

    assert.equal(response.statusCode, 404, response.body);
    assert.equal(serviceVisitCreated, false);
  } finally {
    await app.close();
  }
});

test("staff cannot start with a suspended membership", async () => {
  const staff = { id: "staff-1", role: "STAFF", status: "ACTIVE" };
  const membershipId = "44444444-4444-4444-8444-444444444444";
  let serviceVisitCreated = false;

  (prisma as any).user = {
    findUnique: async () => staff,
  };
  (prisma as any).salon = {
    findUnique: async () => ({ id: activeTicket.salonId, ownerId: "owner-1" }),
  };

  const tx = {
    notification: (prisma as any).notification,
    queueEntry: {
      findUnique: async () => activeTicket,
    },
    staffMembership: {
      findUnique: async () => ({
        id: membershipId,
        userId: staff.id,
        salonId: activeTicket.salonId,
        status: "SUSPENDED",
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
        return { id: "visit-1" };
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
          sub: staff.id,
          role: "STAFF",
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

test("staff cannot start when staff presence is not confirmed", async () => {
  const staff = { id: "staff-1", role: "STAFF", status: "ACTIVE" };
  const membershipId = "44444444-4444-4444-8444-444444444444";
  let serviceVisitCreated = false;

  (prisma as any).user = {
    findUnique: async () => staff,
  };
  (prisma as any).salon = {
    findUnique: async () => ({ id: activeTicket.salonId, ownerId: "owner-1" }),
  };

  const tx = {
    notification: (prisma as any).notification,
    queueEntry: {
      findUnique: async () => activeTicket,
    },
    staffMembership: {
      findUnique: async () => ({
        id: membershipId,
        userId: staff.id,
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
        return { id: "visit-1" };
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
          sub: staff.id,
          role: "STAFF",
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

test("admin can start a waiting queue entry at any salon", async () => {
  const admin = { id: "admin-1", role: "ADMIN", status: "ACTIVE" };
  const membershipId = "44444444-4444-4444-8444-444444444444";
  const visitId = "33333333-3333-4333-8333-333333333333";
  const now = Date.now();
  let updateArgs: any;
  let reads = 0;

  (prisma as any).user = {
    findUnique: async () => admin,
  };
  (prisma as any).salon = {
    findUnique: async () => ({ id: activeTicket.salonId, ownerId: "owner-1" }),
  };

  const tx = {
    notification: (prisma as any).notification,
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
        userId: "staff-1",
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
      create: async (args: any) => ({ ...args.data, id: visitId }),
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
          sub: admin.id,
          role: "ADMIN",
        })}`,
      },
      payload: { staffMembershipId: membershipId },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(updateArgs.data.status, "STARTED");
  } finally {
    await app.close();
  }
});

test("queued entry can start when walk-in intake is disabled", async () => {
  const owner = { id: "owner-1", role: "OWNER", status: "ACTIVE" };
  const membershipId = "44444444-4444-4444-8444-444444444444";
  const now = Date.now();
  let updateArgs: any;

  (prisma as any).user = {
    findUnique: async () => owner,
  };
  (prisma as any).salon = {
    findUnique: async () => ({
      id: activeTicket.salonId,
      ownerId: owner.id,
      walkInIntakeEnabled: false,
    }),
  };

  const tx = {
    notification: (prisma as any).notification,
    queueEntry: {
      findUnique: async () => activeTicket,
      updateMany: async (args: any) => {
        updateArgs = args;
        return { count: 1 };
      },
    },
    staffMembership: {
      findUnique: async () => ({
        id: membershipId,
        userId: "staff-1",
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
      create: async (args: any) => ({ ...args.data, id: "visit-1" }),
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
    assert.equal(updateArgs.data.status, "STARTED");
  } finally {
    await app.close();
  }
});

test("concurrent start returns conflict", async () => {
  const owner = { id: "owner-1", role: "OWNER", status: "ACTIVE" };
  const membershipId = "44444444-4444-4444-8444-444444444444";
  const now = Date.now();
  let createCalled = false;

  (prisma as any).user = {
    findUnique: async () => owner,
  };
  (prisma as any).salon = {
    findUnique: async () => ({ id: activeTicket.salonId, ownerId: owner.id }),
  };

  const tx = {
    notification: (prisma as any).notification,
    queueEntry: {
      findUnique: async () => activeTicket,
      updateMany: async () => ({ count: 0 }),
    },
    staffMembership: {
      findUnique: async () => ({
        id: membershipId,
        userId: "staff-1",
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
      create: async () => {
        createCalled = true;
        return { id: "visit-1" };
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
    assert.equal(response.json().error, "Queue entry changed");
    assert.equal(createCalled, true);
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
    notification: (prisma as any).notification,
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

for (const gate of ['isActive','saloTicketIntakeEnabled','walkInIntakeEnabled','saloTicketGloballyEnabled','walkInGloballyEnabled']) test(`ticket creation respects ${gate}`, async()=>{
 mockAuthenticatedCustomer();
 (prisma as any).salon={findUnique:async()=>({id:activeTicket.salonId,ownerId:'owner-1',isActive:true,saloTicketIntakeEnabled:true,walkInIntakeEnabled:true,[gate]:false})};
 (prisma as any).platformSettings={findUnique:async()=>({saloTicketGloballyEnabled:true,walkInGloballyEnabled:true,...(gate.endsWith('GloballyEnabled')?{[gate]:false}:{})})};
 (prisma as any).queueEntry={findFirst:async()=>null,create:async()=>assert.fail('must not create')};
 const app=Fastify();await queueRoutes(app);
 try{const r=await app.inject({method:'POST',url:`/api/v1/salons/${activeTicket.salonId}/queue/tickets`,headers:{authorization:`Bearer ${signAccessToken({sub:customer.id,role:'CUSTOMER'})}`}});assert.equal(r.statusCode,409,r.body);}finally{await app.close();}
});
for(const status of ['WAITING','CALLED','STARTED','CANCELLED','EXPIRED','NO_SHOW']) test(`own ticket read: ${status}, scoped and privacy-safe`,async()=>{
 mockAuthenticatedCustomer();let reads=0;const serverNow=Date.now();
 (prisma as any).staffMembership={findMany:async()=>[{id:'mem-1',userId:'staff-1',salonId:activeTicket.salonId,barberId:'barber-1',status:'ACTIVE',revokedAt:null,presence:{staffMembershipId:'mem-1',dutyState:'ON_DUTY',generation:1,leases:[{staffMembershipId:'mem-1',generation:1,evidenceSource:'STAFF_APP',producerKey:'app-1',observedAt:new Date(serverNow-10_000),validUntil:new Date(serverNow+250_000),revokedAt:null}]},serviceVisits:[]}]};
 (prisma as any).service={findMany:async()=>[{durationMin:30}]};
 (prisma as any).queueEntry={findFirst:async(args:any)=>{assert.equal(args.where.customerId,customer.id);assert.equal(args.where.source,'SALO_TICKET');reads++;if(reads===1&&!['WAITING','CALLED'].includes(status))return null;return {...activeTicket,status,serviceVisit:status==='STARTED'?{status:'COMPLETED',completedAt:new Date()}:null,salon:{id:activeTicket.salonId,name:'Public salon',isActive:true,saloTicketIntakeEnabled:true,walkInIntakeEnabled:true,openingTime:'09:00',closingTime:'18:00',timeZone:'Europe/Berlin',workingDays:['mon','tue','wed','thu','fri','sat','sun']}};},count:async(args:any)=>{assert.equal(args.where.salonId,activeTicket.salonId);assert.deepEqual(args.where.status.in,['WAITING','CALLED']);assert.equal(args.where.OR[1].id.lt,activeTicket.id);return 2;}};
 const app=Fastify();await queueRoutes(app);
 try{const r=await app.inject({url:'/api/v1/queue/tickets/mine?customerId=other-customer',headers:{authorization:`Bearer ${signAccessToken({sub:customer.id,role:'CUSTOMER'})}`}});assert.equal(r.statusCode,200,r.body);const b=r.json();assert.equal(b.ticket.status,status);assert.equal(b.position,['WAITING','CALLED'].includes(status)?3:null);assert.equal(b.ahead,['WAITING','CALLED'].includes(status)?2:null);assert.equal(b.active,['WAITING','CALLED'].includes(status));
  if(b.active){assert.ok(b.wait,'an active ticket exposes the derived SMART wait state');assert.equal(b.wait.salonId,activeTicket.salonId);assert.ok(['CLOSED','WALK_IN_DISABLED','STAFF_STATUS_UNCONFIRMED','AVAILABLE_NOW','ESTIMATED_WAIT','WAIT_UNKNOWN'].includes(b.wait.state));assert.equal(b.wait.queueLength,null,'the ticket view never discloses the salon queue length');assert.equal(b.wait.queueAhead,2);assert.ok(!/customer|email|phone/i.test(JSON.stringify(b.wait)),'wait payload must stay aggregate-only');if(b.wait.state==='AVAILABLE_NOW')assert.equal(b.wait.etaMinutes,0);else assert.equal(b.wait.etaMinutes,null);}
  else assert.equal(b.wait,null,'a non-active ticket never exposes a wait estimate');
  assert.equal(r.headers['cache-control'],'no-store');}finally{await app.close();}
});
for(const role of ['OWNER','STAFF']) test(`${role} cannot create or read customer ticket`,async()=>{
  (prisma as any).user={findUnique:async()=>({...customer,role})};const app=Fastify();await queueRoutes(app);
  try{for(const [method,url] of [['GET','/api/v1/queue/tickets/mine'],['POST',`/api/v1/salons/${activeTicket.salonId}/queue/tickets`]]){const r=await app.inject({method:method as any,url,headers:{authorization:`Bearer ${signAccessToken({sub:customer.id,role:role as any})}`}});assert.equal(r.statusCode,403,r.body);}}finally{await app.close();}
});

const walkInSalonId = "22222222-2222-4222-8222-222222222222";
const walkInEntry = {
  id: "55555555-5555-4555-8555-555555555555",
  salonId: walkInSalonId,
  customerId: null,
  serviceVisitId: null,
  source: "MANUAL_WALK_IN",
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

function mockWalkInSalon(overrides: any = {}) {
  (prisma as any).salon = {
    findUnique: async () => ({
      id: walkInSalonId,
      ownerId: "owner-1",
      isActive: true,
      walkInIntakeEnabled: true,
      ...overrides,
    }),
  };
}

function mockWalkInCreate() {
  (prisma as any).queueEntry = {
    create: async (args: any) => {
      assert.equal(args.data.salonId, walkInSalonId);
      assert.equal(args.data.source, "MANUAL_WALK_IN");
      assert.equal(args.data.status, "WAITING");
      assert.equal(args.data.customerId, undefined);
      assert.ok(args.data.joinedAt instanceof Date);
      return walkInEntry;
    },
  };
}

test("owner creates a walk-in queue entry in WAITING", async () => {
  const owner = { id: "owner-1", role: "OWNER", status: "ACTIVE" };
  (prisma as any).user = { findUnique: async () => owner };
  mockWalkInSalon();
  mockWalkInCreate();

  const app = Fastify();
  await queueRoutes(app);

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/salons/${walkInSalonId}/queue/walk-in`,
      headers: {
        authorization: `Bearer ${signAccessToken({ sub: owner.id, role: "OWNER" })}`,
      },
    });

    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().created, true);
    assert.equal(response.json().queueEntry.id, walkInEntry.id);
    assert.equal(response.json().queueEntry.source, "MANUAL_WALK_IN");
    assert.equal(response.json().queueEntry.status, "WAITING");
  } finally {
    await app.close();
  }
});

test("staff creates a walk-in queue entry", async () => {
  const staff = { id: "staff-1", role: "STAFF", status: "ACTIVE" };
  const membershipId = "44444444-4444-4444-8444-444444444444";
  (prisma as any).user = { findUnique: async () => staff };
  mockWalkInSalon();
  (prisma as any).staffMembership = {
    findFirst: async () => ({ id: membershipId, salonId: walkInSalonId, userId: staff.id, status: "ACTIVE", revokedAt: null }),
  };
  mockWalkInCreate();

  const app = Fastify();
  await queueRoutes(app);

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/salons/${walkInSalonId}/queue/walk-in`,
      headers: {
        authorization: `Bearer ${signAccessToken({ sub: staff.id, role: "STAFF" })}`,
      },
    });

    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().created, true);
    assert.equal(response.json().queueEntry.source, "MANUAL_WALK_IN");
  } finally {
    await app.close();
  }
});

test("customer cannot create a walk-in", async () => {
  (prisma as any).user = { findUnique: async () => customer };
  mockWalkInSalon();
  mockWalkInCreate();

  const app = Fastify();
  await queueRoutes(app);

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/salons/${walkInSalonId}/queue/walk-in`,
      headers: {
        authorization: `Bearer ${signAccessToken({ sub: customer.id, role: "CUSTOMER" })}`,
      },
    });

    assert.equal(response.statusCode, 403, response.body);
  } finally {
    await app.close();
  }
});

test("owner cannot create a walk-in for another salon", async () => {
  const owner = { id: "owner-2", role: "OWNER", status: "ACTIVE" };
  (prisma as any).user = { findUnique: async () => owner };
  mockWalkInSalon({ ownerId: "different-owner-id" });
  mockWalkInCreate();

  const app = Fastify();
  await queueRoutes(app);

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/salons/${walkInSalonId}/queue/walk-in`,
      headers: {
        authorization: `Bearer ${signAccessToken({ sub: owner.id, role: "OWNER" })}`,
      },
    });

    assert.equal(response.statusCode, 403, response.body);
  } finally {
    await app.close();
  }
});

test("walk-in creation is rejected when salon walk-in intake is disabled", async () => {
  const owner = { id: "owner-1", role: "OWNER", status: "ACTIVE" };
  let createCalled = false;
  (prisma as any).user = { findUnique: async () => owner };
  mockWalkInSalon({ walkInIntakeEnabled: false });
  (prisma as any).queueEntry = {
    create: async () => {
      createCalled = true;
      return walkInEntry;
    },
  };

  const app = Fastify();
  await queueRoutes(app);

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/salons/${walkInSalonId}/queue/walk-in`,
      headers: {
        authorization: `Bearer ${signAccessToken({ sub: owner.id, role: "OWNER" })}`,
      },
    });

    assert.equal(response.statusCode, 409, response.body);
    assert.equal(createCalled, false);
  } finally {
    await app.close();
  }
});

test("walk-in creation is rejected when globally disabled", async () => {
  const owner = { id: "owner-1", role: "OWNER", status: "ACTIVE" };
  let createCalled = false;
  (prisma as any).user = { findUnique: async () => owner };
  mockWalkInSalon();
  (prisma as any).platformSettings = {
    findUnique: async () => ({ saloTicketGloballyEnabled: true, walkInGloballyEnabled: false }),
  };
  (prisma as any).queueEntry = {
    create: async () => {
      createCalled = true;
      return walkInEntry;
    },
  };

  const app = Fastify();
  await queueRoutes(app);

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/salons/${walkInSalonId}/queue/walk-in`,
      headers: {
        authorization: `Bearer ${signAccessToken({ sub: owner.id, role: "OWNER" })}`,
      },
    });

    assert.equal(response.statusCode, 409, response.body);
    assert.equal(createCalled, false);
  } finally {
    await app.close();
  }
});

test("walk-in creation is rejected when salon is inactive", async () => {
  const owner = { id: "owner-1", role: "OWNER", status: "ACTIVE" };
  let createCalled = false;
  (prisma as any).user = { findUnique: async () => owner };
  mockWalkInSalon({ isActive: false });
  (prisma as any).queueEntry = {
    create: async () => {
      createCalled = true;
      return walkInEntry;
    },
  };

  const app = Fastify();
  await queueRoutes(app);

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/salons/${walkInSalonId}/queue/walk-in`,
      headers: {
        authorization: `Bearer ${signAccessToken({ sub: owner.id, role: "OWNER" })}`,
      },
    });

    assert.equal(response.statusCode, 409, response.body);
    assert.equal(createCalled, false);
  } finally {
    await app.close();
  }
});

test("walk-in creation is rejected for unknown salon", async () => {
  const owner = { id: "owner-1", role: "OWNER", status: "ACTIVE" };
  (prisma as any).user = { findUnique: async () => owner };
  (prisma as any).salon = { findUnique: async () => null };

  const app = Fastify();
  await queueRoutes(app);

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/salons/${walkInSalonId}/queue/walk-in`,
      headers: {
        authorization: `Bearer ${signAccessToken({ sub: owner.id, role: "OWNER" })}`,
      },
    });

    assert.equal(response.statusCode, 404, response.body);
  } finally {
    await app.close();
  }
});
