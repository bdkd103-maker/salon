import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { requireRole } from "./auth.js";

describe("requireRole", () => {
  it("allows access when the user has an allowed role", () => {
    const reply = {
      code: (status: number) => ({
        send: (payload: unknown) => ({ status, payload }),
      }),
    };

    const user = { id: "user-1", role: "ADMIN" };
    const result = requireRole(user, ["ADMIN", "OWNER"], reply as any);

    assert.deepEqual(result, user);
  });

  it("blocks access when the user role is not permitted", () => {
    const reply = {
      code: (status: number) => ({
        send: (payload: unknown) => {
          const error = new Error("Forbidden");
          (error as any).status = status;
          (error as any).payload = payload;
          throw error;
        },
      }),
    };

    assert.throws(() => requireRole({ id: "user-2", role: "CUSTOMER" }, ["ADMIN"], reply as any), /Forbidden/);
  });
});
