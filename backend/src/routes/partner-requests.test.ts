import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import Fastify from "fastify";

import { signAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { partnerRequestRoutes } from "./partner-requests.js";

process.env.JWT_ACCESS_SECRET = "partner-requests-test-secret";

const mock = prisma as any;
const original = {
  partnerRequest: mock.partnerRequest,
  platformSettings: mock.platformSettings,
  user: mock.user,
  $queryRaw: mock.$queryRaw,
};

const baseApplication = {
  salonName: "Test Salon",
  contactName: "Test Contact",
  contactEmail: "contact@example.test",
  city: "Berlin",
};

function auth(role: string, userId: string) {
  return { authorization: `Bearer ${signAccessToken({ sub: userId, role })}` };
}

beforeEach(() => {
  mock.user = {
    findUnique: async ({ where }: any) => ({ id: where.id, role: where.id.startsWith("admin") ? "ADMIN" : "CUSTOMER", status: "ACTIVE" }),
  };
  mock.platformSettings = {
    findUnique: async () => ({
      id: "platform",
      siteName: "SALO",
      supportEmail: "",
      defaultLocale: "ar",
      customerRegistrationEnabled: true,
      salonApplicationsEnabled: true,
      bookingGloballyEnabled: true,
      saloTicketGloballyEnabled: true,
      walkInGloballyEnabled: true,
      staffStatusLiveEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    create: async ({ data }: any) => ({ id: "platform", createdAt: new Date(), updatedAt: new Date(), ...data }),
    update: async ({ data }: any) => ({ id: "platform", createdAt: new Date(), updatedAt: new Date(), salonApplicationsEnabled: true, customerRegistrationEnabled: true, bookingGloballyEnabled: true, saloTicketGloballyEnabled: true, walkInGloballyEnabled: true, staffStatusLiveEnabled: true, siteName: "SALO", supportEmail: "", defaultLocale: "ar", ...data }),
    upsert: async ({ create, update }: any) => ({ id: "platform", createdAt: new Date(), updatedAt: new Date(), salonApplicationsEnabled: true, customerRegistrationEnabled: true, bookingGloballyEnabled: true, saloTicketGloballyEnabled: true, walkInGloballyEnabled: true, staffStatusLiveEnabled: true, siteName: "SALO", supportEmail: "", defaultLocale: "ar", ...create, ...update }),
  };
  mock.partnerRequest = {
    create: async ({ data }: any) => ({
      id: "pr-1",
      ...data,
      status: "PENDING",
      rejectReason: null,
      reviewedByUserId: null,
      reviewedAt: null,
      createdAt: new Date(),
    }),
    findMany: async () => [],
    findUnique: async () => null,
    update: async ({ data }: any) => ({
      id: "pr-1",
      ...baseApplication,
      contactPhone: null,
      message: null,
      status: data.status,
      rejectReason: data.rejectReason ?? null,
      reviewedByUserId: data.reviewedByUserId ?? null,
      reviewedAt: data.reviewedAt ?? null,
      createdAt: new Date(),
    }),
  };
});

afterEach(() => Object.assign(mock, original));

test("public salon application creates a pending PartnerRequest in the database", async () => {
  const app = Fastify();
  await partnerRequestRoutes(app);
  try {
    const invalid = await app.inject({ method: "POST", url: "/api/v1/partner-requests", payload: { salonName: "X" } });
    assert.equal(invalid.statusCode, 400);

    const created = await app.inject({ method: "POST", url: "/api/v1/partner-requests", payload: baseApplication });
    assert.equal(created.statusCode, 201);
    const body = created.json();
    assert.equal(body.status, "PENDING");
    assert.equal(body.request.salonName, "Test Salon");
    assert.equal(body.request.status, "PENDING");
  } finally {
    await app.close();
  }
});

test("salon applications are blocked with SALON_APPLICATIONS_DISABLED when the platform flag is off", async () => {
  mock.platformSettings.findUnique = async () => ({
    id: "platform",
    salonApplicationsEnabled: false,
    customerRegistrationEnabled: true,
    bookingGloballyEnabled: true,
    saloTicketGloballyEnabled: true,
    walkInGloballyEnabled: true,
    staffStatusLiveEnabled: true,
    siteName: "SALO",
    supportEmail: "",
    defaultLocale: "ar",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  mock.partnerRequest.create = async () => {
    throw new Error("create must not run when applications are disabled");
  };
  const app = Fastify();
  await partnerRequestRoutes(app);
  try {
    const response = await app.inject({ method: "POST", url: "/api/v1/partner-requests", payload: baseApplication });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().code, "SALON_APPLICATIONS_DISABLED");
  } finally {
    await app.close();
  }
});

test("admin review is authorized, records reviewer metadata, and rejects invalid transitions", async () => {
  let storedStatus = "PENDING";
  mock.partnerRequest.findUnique = async ({ where }: any) =>
    where?.id === "pr-1"
      ? {
          id: "pr-1",
          ...baseApplication,
          contactPhone: null,
          message: null,
          status: storedStatus,
          rejectReason: null,
          reviewedByUserId: null,
          reviewedAt: null,
          createdAt: new Date(),
        }
      : null;
  mock.partnerRequest.update = async ({ data }: any) => {
    storedStatus = data.status;
    return {
      id: "pr-1",
      ...baseApplication,
      contactPhone: null,
      message: null,
      status: data.status,
      rejectReason: data.rejectReason ?? null,
      reviewedByUserId: data.reviewedByUserId,
      reviewedAt: data.reviewedAt,
      createdAt: new Date(),
    };
  };
  mock.partnerRequest.findMany = async () => [{
    id: "pr-1",
    status: storedStatus,
    salonName: "Test Salon",
    contactName: "Test Contact",
    contactEmail: "contact@example.test",
    contactPhone: null,
    city: "Berlin",
    message: null,
    rejectReason: null,
    reviewedByUserId: null,
    reviewedAt: null,
    createdAt: new Date(),
  }];

  const app = Fastify();
  await partnerRequestRoutes(app);
  try {
    assert.equal((await app.inject({ url: "/api/v1/admin/partner-requests" })).statusCode, 401);
    assert.equal((await app.inject({ method: "PATCH", url: "/api/v1/admin/partner-requests/pr-1", headers: auth("CUSTOMER", "customer-1"), payload: { status: "APPROVED" } })).statusCode, 403);

    const list = await app.inject({ url: "/api/v1/admin/partner-requests", headers: auth("ADMIN", "admin-1") });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().requests.length, 1);

    const approve = await app.inject({ method: "PATCH", url: "/api/v1/admin/partner-requests/pr-1", headers: auth("ADMIN", "admin-1"), payload: { status: "APPROVED" } });
    assert.equal(approve.statusCode, 200);
    const approved = approve.json().request;
    assert.equal(approved.status, "APPROVED");
    assert.equal(approved.reviewedByUserId, "admin-1");
    assert.ok(approved.reviewedAt);

    const transition = await app.inject({ method: "PATCH", url: "/api/v1/admin/partner-requests/pr-1", headers: auth("ADMIN", "admin-1"), payload: { status: "REJECTED" } });
    assert.equal(transition.statusCode, 409);
    assert.equal(transition.json().code, "INVALID_TRANSITION");
    assert.equal(transition.json().status, "APPROVED");

    const badPayload = await app.inject({ method: "PATCH", url: "/api/v1/admin/partner-requests/pr-1", headers: auth("ADMIN", "admin-1"), payload: { status: "PENDING" } });
    assert.equal(badPayload.statusCode, 400);

    const missing = await app.inject({ method: "PATCH", url: "/api/v1/admin/partner-requests/nope", headers: auth("ADMIN", "admin-1"), payload: { status: "APPROVED" } });
    assert.equal(missing.statusCode, 404);
  } finally {
    await app.close();
  }
});

test("rejecting a pending application persists rejectReason", async () => {
  let stored: any = { id: "pr-1", status: "PENDING", rejectReason: null, reviewedByUserId: null, reviewedAt: null };
  mock.partnerRequest.findUnique = async () => ({ ...stored, ...baseApplication, contactPhone: null, message: null, createdAt: new Date() });
  mock.partnerRequest.update = async ({ data }: any) => {
    stored = { ...stored, ...data };
    return { ...stored, ...baseApplication, contactPhone: null, message: null, createdAt: new Date() };
  };
  const app = Fastify();
  await partnerRequestRoutes(app);
  try {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/partner-requests/pr-1",
      headers: auth("ADMIN", "admin-1"),
      payload: { status: "REJECTED", rejectReason: "Not a fit" },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().request.status, "REJECTED");
    assert.equal(stored.rejectReason, "Not a fit");
    assert.equal(stored.reviewedByUserId, "admin-1");
  } finally {
    await app.close();
  }
});
