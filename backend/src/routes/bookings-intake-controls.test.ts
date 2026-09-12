import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import Fastify from "fastify";

import { signAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { bookingRoutes } from "./bookings.js";

const original = {
  user: prisma.user,
  salon: prisma.salon,
  booking: prisma.booking,
};

const mock = prisma as any;
let createCalls = 0;
let previousSecret: string | undefined;

beforeEach(() => {
  previousSecret = process.env.JWT_ACCESS_SECRET;
  process.env.JWT_ACCESS_SECRET = "booking-intake-controls-test-secret";
  createCalls = 0;

  mock.user = {
    findUnique: async ({ where }: any) => ({
      id: where.id,
      fullName: "Customer",
      phone: null,
      role: "CUSTOMER",
      status: "ACTIVE",
    }),
  };

  mock.salon = {
    findUnique: async () => ({
      id: "salon-1",
      ownerId: "owner-1",
      name: "Salon",
      isActive: true,
      bookingIntakeEnabled: false,
      openingTime: "09:00",
      closingTime: "20:00",
      services: [],
      barbers: [],
    }),
  };

  mock.booking = {
    count: async () => 0,
    create: async () => {
      createCalls++;
      throw new Error("booking.create must not be reached when intake is disabled");
    },
  };
});

afterEach(() => {
  Object.assign(mock, original);

  if (previousSecret === undefined) {
    delete process.env.JWT_ACCESS_SECRET;
  } else {
    process.env.JWT_ACCESS_SECRET = previousSecret;
  }
});

test("POST booking rejects new intake when booking intake is disabled", async () => {
  const app = Fastify();

  try {
    await bookingRoutes(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/bookings",
      headers: {
        authorization: `Bearer ${signAccessToken({
          sub: "customer-1",
          role: "CUSTOMER",
        })}`,
      },
      payload: {
        salonId: "salon-1",
        startAt: "2026-09-14T10:00:00",
        endAt: "2026-09-14T11:00:00",
        timeZone: "Europe/Berlin",
      },
    });

    assert.equal(response.statusCode, 409, response.body);
    assert.deepEqual(response.json(), {
      error: "Booking intake is currently disabled",
    });
    assert.equal(createCalls, 0);
  } finally {
    await app.close();
  }
});