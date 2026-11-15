import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import Fastify from "fastify";

import { signAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { dashboardRoutes } from "./dashboard.js";

process.env.JWT_ACCESS_SECRET = "messages-security-test-secret";

const mock = prisma as any;
const original = {
  user: mock.user,
  message: mock.message,
};

let capturedInclude: any = null;

function pick(source: Record<string, unknown>, select?: Record<string, unknown>) {
  if (!select) return source;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(select)) out[key] = source[key];
  return out;
}

beforeEach(() => {
  capturedInclude = null;
  mock.user = {
    findUnique: async ({ where }: any) => ({ id: where.id, role: "OWNER", status: "ACTIVE" }),
  };
  const senderSource = {
    id: "user-1",
    fullName: "Sender Name",
    email: "sender@example.test",
    phone: "+4915100000001",
    passwordHash: "$argon2id$v=19$m=65536$super-secret-hash",
    deletedAt: null,
    status: "ACTIVE",
    role: "OWNER",
  };
  const receiverSource = {
    id: "user-2",
    fullName: "Receiver Name",
    email: "receiver@example.test",
    phone: "+4915100000002",
    passwordHash: "$argon2id$v=19$m=65536$another-secret-hash",
    deletedAt: null,
    status: "CUSTOMER",
    role: "CUSTOMER",
  };
  const salonSource = { id: "salon-1", name: "Salon", ownerId: "user-1", phone: "+4915100000003" };
  mock.message = {
    findMany: async (args: any) => {
      capturedInclude = args?.include;
      return [{
        id: "msg-1",
        senderId: "user-1",
        receiverId: "user-2",
        salonId: "salon-1",
        subject: "Hello",
        body: "Body",
        isRead: false,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        sender: pick(senderSource, args?.include?.sender?.select),
        receiver: pick(receiverSource, args?.include?.receiver?.select),
        salon: pick(salonSource, args?.include?.salon?.select),
      }];
    },
  };
});

afterEach(() => Object.assign(mock, original));

test("GET /api/v1/messages never renders credentials for sender or receiver", async () => {
  const app = Fastify();
  await dashboardRoutes(app);
  try {
    const response = await app.inject({
      url: "/api/v1/messages",
      headers: { authorization: `Bearer ${signAccessToken({ sub: "user-1", role: "OWNER" })}` },
    });
    assert.equal(response.statusCode, 200);
    assert.ok(capturedInclude, "messages route must still include related parties");
    assert.deepEqual(Object.keys(capturedInclude.sender.select).sort(), ["email", "fullName", "id", "phone"]);
    assert.deepEqual(Object.keys(capturedInclude.receiver.select).sort(), ["email", "fullName", "id", "phone"]);
    assert.equal(response.body.includes("passwordHash"), false);
    assert.equal(response.body.includes("argon2"), false);
    assert.equal(response.body.includes("secret-hash"), false);
    assert.equal(response.body.includes("deletedAt"), false);

    const message = response.json().messages[0];
    assert.equal(message.sender.fullName, "Sender Name");
    assert.equal(message.sender.email, "sender@example.test");
    assert.equal(message.receiver.fullName, "Receiver Name");
    assert.equal(message.salon.name, "Salon");
  } finally {
    await app.close();
  }
});
