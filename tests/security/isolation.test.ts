import { describe, expect, it } from "vitest";
import { json, testApp } from "../helpers/app.js";
import { createMemoryContainer } from "../../src/composition/memory-container.js";
import { login, bootstrapTenant } from "../../src/application/identity/auth.js";
import type { Principal } from "../../src/application/authorization/policies.js";
import { requirePermission } from "../../src/application/authorization/policies.js";
import { AppError } from "../../src/shared/errors.js";

describe("security", () => {
  it("ignores client tenant headers", async () => {
    const { app, env, container } = testApp();
    await bootstrapTenant(container, {
      email: "s@example.com",
      password: "correct horse",
      displayName: "S",
      tenantName: "Sec",
    });
    const loginRes = await json(app, env, "POST", "/api/v1/auth/login", {
      email: "s@example.com",
      password: "correct horse",
    });
    const cookie = loginRes.cookies.find((c) => c.startsWith("oe_session="))!.split(";")[0]!;
    const me = await json(app, env, "GET", "/api/v1/users/me", undefined, {
      cookie,
      "x-tenant-id": "attacker",
      "x-role": "owner",
      "x-user-id": "evil",
    });
    const data = me.body.data as { tenantId: string; role: string };
    expect(data.role).toBe("owner");
    expect(data.tenantId).not.toBe("attacker");
  });

  it("blocks privilege escalation for viewers", () => {
    const principal: Principal = {
      kind: "session",
      userId: "u" as never,
      tenantId: "t" as never,
      sessionId: "s" as never,
      role: "viewer",
    };
    expect(() => requirePermission(principal, "retention:write")).toThrow(AppError);
    expect(() => requirePermission(principal, "api-keys:write")).toThrow(AppError);
  });

  it("does not return raw password hashes on login", async () => {
    const { container } = createMemoryContainer();
    await bootstrapTenant(container, {
      email: "h@example.com",
      password: "correct horse",
      displayName: "H",
      tenantName: "H",
    });
    const result = await login(container, {
      email: "h@example.com",
      password: "correct horse",
      userAgent: null,
      ipHash: null,
    });
    expect(JSON.stringify(result)).not.toContain("passwordHash");
  });
});
