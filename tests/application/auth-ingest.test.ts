import { describe, expect, it } from "vitest";
import { createMemoryContainer } from "../../src/composition/memory-container.js";
import {
  login,
  bootstrapTenant,
  resolveApiKey,
  createApiKey,
} from "../../src/application/identity/auth.js";
import { ingestLogs } from "../../src/application/ingestion/ingest.js";
import { consumeIngestBatch } from "../../src/application/ingestion/consume.js";
import { runLogQuery } from "../../src/application/query/run-log-query.js";
import { requestDeletion } from "../../src/application/catalog/resources.js";
import { processDeletionJob } from "../../src/application/deletion/process.js";
import { requirePermission, type Principal } from "../../src/application/authorization/policies.js";
import { AppError } from "../../src/shared/errors.js";

const password = "correct horse";

describe("auth and isolation", () => {
  it("bootstraps tenants, logs in, and isolates them", async () => {
    const a = createMemoryContainer(1_700_000_000_000);
    const b = createMemoryContainer(1_700_000_000_000);
    const ra = await bootstrapTenant(a.container, {
      email: "a@example.com",
      password,
      displayName: "A",
      tenantName: "Alpha",
    });
    const rb = await bootstrapTenant(b.container, {
      email: "b@example.com",
      password,
      displayName: "B",
      tenantName: "Beta",
    });
    expect(ra.tenantId).not.toBe(rb.tenantId);
    const session = await login(a.container, {
      email: "a@example.com",
      password,
      userAgent: "test",
      ipHash: "1",
    });
    expect(session.token.length).toBeGreaterThan(20);
    const viewer: Principal = {
      kind: "session",
      userId: ra.userId,
      tenantId: ra.tenantId,
      sessionId: session.sessionId as never,
      role: "viewer",
    };
    expect(() => requirePermission(viewer, "logs:write")).toThrow(AppError);
  });
});

describe("ingest + query", () => {
  it("ingests asynchronously and queries tenant data only", async () => {
    const { world, container } = createMemoryContainer(1_700_000_000_000);
    const reg = await bootstrapTenant(container, {
      email: "o@example.com",
      password,
      displayName: "O",
      tenantName: "Org",
    });
    const session = await login(container, {
      email: "o@example.com",
      password,
      userAgent: null,
      ipHash: null,
    });
    const principal: Principal = {
      kind: "session",
      userId: reg.userId,
      tenantId: reg.tenantId,
      sessionId: session.sessionId as never,
      role: "owner",
    };
    await ingestLogs(container, principal, [
      { line: "boom error", labels: { service: "api", environment: "prod" } },
    ]);
    expect(world.ingestQueue).toHaveLength(1);
    await consumeIngestBatch(container, world.ingestQueue);
    const result = await runLogQuery(container, principal, {
      query: '{service="api"} |= "boom"',
      start: 1_700_000_000_000 - 1000,
      end: 1_700_000_000_000 + 1000,
    });
    expect(result.hits).toHaveLength(1);
    const other: Principal = { ...principal, tenantId: "other" as never };
    await expect(
      runLogQuery(container, other, {
        query: '{service="api"}',
        start: 1_700_000_000_000 - 1000,
        end: 1_700_000_000_000 + 1000,
      }),
    ).resolves.toMatchObject({ hits: [] });
  });

  it("dedups repeated queue delivery", async () => {
    const { world, container } = createMemoryContainer(1_700_000_000_000);
    const reg = await bootstrapTenant(container, {
      email: "d@example.com",
      password,
      displayName: "D",
      tenantName: "Dedup",
    });
    const session = await login(container, {
      email: "d@example.com",
      password,
      userAgent: null,
      ipHash: null,
    });
    const principal: Principal = {
      kind: "session",
      userId: reg.userId,
      tenantId: reg.tenantId,
      sessionId: session.sessionId as never,
      role: "owner",
    };
    await ingestLogs(container, principal, [
      { eventId: "e1", line: "once", labels: { service: "api" } },
    ]);
    await consumeIngestBatch(container, world.ingestQueue);
    await consumeIngestBatch(container, world.ingestQueue);
    expect(world.logChunks.size).toBe(1);
  });
});

describe("api keys and deletion", () => {
  it("creates a hashed key and processes deletion jobs", async () => {
    const { world, container } = createMemoryContainer(1_700_000_000_000);
    const reg = await bootstrapTenant(container, {
      email: "k@example.com",
      password,
      displayName: "K",
      tenantName: "Keys",
    });
    const session = await login(container, {
      email: "k@example.com",
      password,
      userAgent: null,
      ipHash: null,
    });
    const principal: Principal = {
      kind: "session",
      userId: reg.userId,
      tenantId: reg.tenantId,
      sessionId: session.sessionId as never,
      role: "owner",
    };
    const created = await createApiKey(container, principal, {
      name: "agent",
      scopes: ["logs:write"],
      expiresAt: null,
    });
    expect(created.token.startsWith("oe_")).toBe(true);
    const keyPrincipal = await resolveApiKey(container, created.token);
    expect(keyPrincipal.kind).toBe("apiKey");
    const job = await requestDeletion(container, principal, "logs");
    await processDeletionJob(container, job.id);
    expect(
      world.jobs.get(job.id)?.status === "completed" ||
        world.jobs.get(job.id)?.status === "processing",
    ).toBe(true);
  });
});
