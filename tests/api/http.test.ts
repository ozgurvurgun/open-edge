import { describe, expect, it } from "vitest";
import { bootstrapTenant } from "../../src/application/identity/auth.js";
import { json, testApp } from "../helpers/app.js";

describe("HTTP API", () => {
  it("rejects public registration", async () => {
    const { app, env } = testApp();
    const res = await app.request(
      "/api/v1/auth/register",
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-open-edge-csrf": "1" },
        body: JSON.stringify({
          email: "u@example.com",
          password: "correct horse",
          displayName: "U",
          tenantName: "T",
        }),
      },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("logs in and reads session after bootstrap", async () => {
    const { app, env, container } = testApp();
    await bootstrapTenant(container, {
      email: "u@example.com",
      password: "correct horse",
      displayName: "U",
      tenantName: "T",
    });
    const login = await json(app, env, "POST", "/api/v1/auth/login", {
      email: "u@example.com",
      password: "correct horse",
    });
    expect(login.status).toBe(200);
    const cookie = login.cookies.find((c) => c.startsWith("oe_session="));
    expect(cookie).toBeTruthy();
    const session = await json(app, env, "GET", "/api/v1/auth/session", undefined, {
      cookie: cookie!.split(";")[0]!,
    });
    expect(session.status).toBe(200);
    expect(session.body.error).toBeNull();
  });

  it("rejects unauthenticated queries", async () => {
    const { app, env } = testApp();
    const res = await json(app, env, "POST", "/api/v1/logs/query", {
      query: '{service="api"}',
      start: 1,
      end: 2,
    });
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("UNAUTHENTICATED");
    expect(JSON.stringify(res.body)).not.toMatch(/stack|D1|SQL/i);
  });

  it("health is public", async () => {
    const { app, env } = testApp();
    const res = await app.request("/health", {}, env);
    expect(res.status).toBe(200);
  });
});
