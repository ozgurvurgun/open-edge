import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "../../env.js";
import type { Container } from "../../composition/container.js";
import { createContainer } from "../../composition/container.js";
import { toPublicError, AppError, ErrorCodes } from "../../shared/errors.js";
import type { Principal } from "../../application/authorization/policies.js";
import {
  changePassword,
  createApiKey,
  listApiKeys,
  listSessions,
  login,
  logout,
  resolveApiKey,
  resolveSession,
  revokeApiKey,
  revokeSession,
  rotateApiKey,
} from "../../application/identity/auth.js";
import {
  changeRole,
  getTenant,
  inviteMember,
  listMembers,
  removeMember,
  requestTenantDeletion,
} from "../../application/tenant/members.js";
import { ingestLogs, ingestMetrics, ingestTraces } from "../../application/ingestion/ingest.js";
import { mapOtlpLogs, mapOtlpMetrics, mapOtlpTraces } from "../../application/otlp/map-otlp.js";
import { runLogQuery } from "../../application/query/run-log-query.js";
import {
  apmEndpoints,
  apmOverview,
  apmServiceMap,
  createSilence,
  deleteAlert,
  deleteDashboard,
  deleteSilence,
  getAlertState,
  getDashboard,
  getDeletionJob,
  getRetention,
  getStream,
  getTrace,
  getUsage,
  listAlertEvents,
  listAlerts,
  listAudit,
  listDashboards,
  listDeletionJobs,
  listMetricSeries,
  listSilences,
  listStreams,
  requestDeletion,
  saveAlert,
  saveDashboard,
  searchTraces,
  updateRetention,
} from "../../application/catalog/resources.js";
import { runMetricQuery } from "../../application/query/run-metric-query.js";
import {
  decodeOtlpLogsProto,
  decodeOtlpMetricsProto,
  decodeOtlpTracesProto,
  isProtobufContentType,
} from "../../application/otlp/decode-proto.js";
import type { Role } from "../../domain/identity/permissions.js";
import type { DeletionTarget } from "../../domain/deletion/job.js";
import type { AlertComparator, AlertKind } from "../../domain/alerting/alert.js";

type AppEnv = {
  Bindings: Env;
  Variables: { container: Container; principal?: Principal };
};

const MAX_BODY = 600 * 1024;

function envelope<T>(data: T) {
  return { data, error: null };
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

function sessionCookie(env: Env, token: string, expiresAt: number): string {
  const name = env.SESSION_COOKIE_NAME || "oe_session";
  const secure = env.ENVIRONMENT === "production" ? "Secure; " : "";
  return `${name}=${encodeURIComponent(token)}; HttpOnly; ${secure}SameSite=Lax; Path=/; Expires=${new Date(expiresAt).toUTCString()}`;
}

function clearCookie(env: Env): string {
  const name = env.SESSION_COOKIE_NAME || "oe_session";
  return `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

async function authenticate(c: {
  req: { header: (n: string) => string | undefined };
  env: Env;
  get: (k: "container") => Container;
}): Promise<Principal> {
  const container = c.get("container");
  const bearer = c.req.header("authorization");
  if (bearer?.startsWith("Bearer oe_")) {
    return resolveApiKey(container, bearer.slice("Bearer ".length));
  }
  const bindingKey =
    c.req.header("x-open-edge-api-key") ?? c.req.header("oe-api-key") ?? c.req.header("x-api-key");
  if (bindingKey?.startsWith("oe_")) {
    return resolveApiKey(container, bindingKey);
  }
  const token = readCookie(c.req.header("cookie"), c.env.SESSION_COOKIE_NAME || "oe_session");
  if (!token) {
    throw new AppError(ErrorCodes.UNAUTHENTICATED, "Authentication is required.", 401);
  }
  return resolveSession(container, token);
}

function assertCsrf(
  c: { req: { method: string; header: (n: string) => string | undefined }; env: Env },
  principal: Principal | undefined,
): void {
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return;
  }
  if (principal?.kind === "apiKey") {
    return;
  }
  const origin = c.req.header("origin");
  const allowed = (c.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (origin && allowed.includes(origin)) {
    return;
  }
  if (c.req.header("x-open-edge-csrf") === "1") {
    return;
  }
  if (!origin && c.req.header("authorization")) {
    return;
  }
  throw new AppError(ErrorCodes.CSRF_REJECTED, "Cross-site request rejected.", 403);
}

async function enforceIngestRateLimit(
  env: Env,
  tenantId: string,
  ip: string | undefined,
): Promise<void> {
  if (!env.INGEST_RATE_LIMIT) return;
  const allowed = await env.INGEST_RATE_LIMIT.limit({
    key: `${tenantId}:${ip ?? "ip"}`,
  });
  if (!allowed.success) {
    throw new AppError(ErrorCodes.RATE_LIMITED, "Ingest rate limit exceeded.", 429);
  }
}

async function enforceQueryRateLimit(env: Env, tenantId: string): Promise<void> {
  if (!env.QUERY_RATE_LIMIT) return;
  const allowed = await env.QUERY_RATE_LIMIT.limit({ key: tenantId });
  if (!allowed.success) {
    throw new AppError(ErrorCodes.RATE_LIMITED, "Query rate limit exceeded.", 429);
  }
}

export function createApp(create: (env: Env) => Container = createContainer) {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("container", create(c.env));
    const origins = (c.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim());
    const corsMw = cors({
      origin: origins,
      credentials: true,
      allowHeaders: [
        "content-type",
        "authorization",
        "x-open-edge-csrf",
        "x-api-key",
        "oe-api-key",
        "x-open-edge-api-key",
      ],
    });
    return corsMw(c, next);
  });

  app.use("/api/v1/*", async (c, next) => {
    const length = Number(c.req.header("content-length") ?? 0);
    if (length > MAX_BODY) {
      throw new AppError(ErrorCodes.PAYLOAD_TOO_LARGE, "Request body is too large.", 413);
    }
    await next();
  });

  app.use("/v1/*", async (c, next) => {
    const length = Number(c.req.header("content-length") ?? 0);
    if (length > MAX_BODY) {
      throw new AppError(ErrorCodes.PAYLOAD_TOO_LARGE, "Request body is too large.", 413);
    }
    await next();
  });

  app.onError((error, c) => {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : "unknown";
    console.error("request_failed", detail);
    const pub = toPublicError(error);
    const res = c.json(
      { data: null, error: { code: pub.code, message: pub.message } },
      pub.httpStatus as 400,
    );
    if (pub.httpStatus === 429) {
      res.headers.set("Retry-After", "60");
      res.headers.set("X-RateLimit-Remaining", "0");
    }
    return res;
  });

  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/ready", async (c) => {
    try {
      await c.env.DB.prepare("SELECT 1").first();
      return c.json({ status: "ready", degraded: false });
    } catch {
      return c.json({ status: "ready", degraded: true });
    }
  });

  const v1 = new Hono<AppEnv>();

  v1.post("/auth/login", async (c) => {
    const limiter = c.env.AUTH_RATE_LIMIT;
    if (limiter) {
      const allowed = await limiter.limit({ key: c.req.header("cf-connecting-ip") ?? "unknown" });
      if (!allowed.success) {
        throw new AppError(ErrorCodes.AUTH_RATE_LIMITED, "Too many authentication attempts.", 429);
      }
    }
    const body = await c.req.json<{ email: string; password: string }>();
    const result = await login(c.get("container"), {
      email: body.email,
      password: body.password,
      userAgent: c.req.header("user-agent") ?? null,
      ipHash: c.req.header("cf-connecting-ip") ?? null,
    });
    c.header("Set-Cookie", sessionCookie(c.env, result.token, result.expiresAt));
    return c.json(envelope({ sessionId: result.sessionId, expiresAt: result.expiresAt }));
  });

  v1.post("/auth/logout", async (c) => {
    const principal = await authenticate(c);
    assertCsrf(c, principal);
    await logout(c.get("container"), principal, null);
    c.header("Set-Cookie", clearCookie(c.env));
    return c.json(envelope({ ok: true }));
  });

  v1.get("/auth/session", async (c) => {
    const principal = await authenticate(c);
    return c.json(envelope(principal));
  });

  v1.post("/auth/change-password", async (c) => {
    const principal = await authenticate(c);
    assertCsrf(c, principal);
    const body = await c.req.json<{ currentPassword: string; newPassword: string }>();
    await changePassword(c.get("container"), principal, body.currentPassword, body.newPassword);
    return c.json(envelope({ ok: true }));
  });

  v1.get("/auth/sessions", async (c) => {
    const principal = await authenticate(c);
    const sessions = await listSessions(c.get("container"), principal);
    return c.json(
      envelope(
        sessions.map((s) => ({
          id: s.id,
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
          revokedAt: s.revokedAt,
          userAgent: s.userAgent,
        })),
      ),
    );
  });

  v1.delete("/auth/sessions/:id", async (c) => {
    const principal = await authenticate(c);
    assertCsrf(c, principal);
    await revokeSession(c.get("container"), principal, c.req.param("id"));
    return c.json(envelope({ ok: true }));
  });

  v1.get("/users/me", async (c) => {
    const principal = await authenticate(c);
    if (principal.kind !== "session") {
      throw new AppError(ErrorCodes.FORBIDDEN, "User profile requires a session.", 403);
    }
    const user = await c.get("container").users.findById(principal.userId);
    if (!user) {
      throw new AppError(ErrorCodes.NOT_FOUND, "User not found.", 404);
    }
    return c.json(
      envelope({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: principal.role,
        tenantId: principal.tenantId,
      }),
    );
  });

  v1.patch("/users/me", async (c) => {
    const principal = await authenticate(c);
    assertCsrf(c, principal);
    if (principal.kind !== "session") {
      throw new AppError(ErrorCodes.FORBIDDEN, "User profile requires a session.", 403);
    }
    const body = await c.req.json<{ displayName: string }>();
    const user = await c.get("container").users.findById(principal.userId);
    if (!user) {
      throw new AppError(ErrorCodes.NOT_FOUND, "User not found.", 404);
    }
    await c.get("container").users.save({
      ...user,
      displayName: body.displayName.trim(),
      updatedAt: c.get("container").clock.now(),
    });
    return c.json(envelope({ ok: true }));
  });

  v1.get("/users", async (c) => {
    const principal = await authenticate(c);
    return c.json(envelope(await listMembers(c.get("container"), principal)));
  });

  v1.post("/users", async (c) => {
    const principal = await authenticate(c);
    assertCsrf(c, principal);
    const body = await c.req.json<{
      email: string;
      displayName: string;
      role: Role;
      password: string;
    }>();
    return c.json(envelope(await inviteMember(c.get("container"), principal, body)), 201);
  });

  v1.patch("/users/:id/role", async (c) => {
    const principal = await authenticate(c);
    assertCsrf(c, principal);
    const body = await c.req.json<{ role: Role }>();
    await changeRole(c.get("container"), principal, c.req.param("id"), body.role);
    return c.json(envelope({ ok: true }));
  });

  v1.delete("/users/:id", async (c) => {
    const principal = await authenticate(c);
    assertCsrf(c, principal);
    await removeMember(c.get("container"), principal, c.req.param("id"));
    return c.json(envelope({ ok: true }));
  });

  v1.get("/tenant", async (c) => {
    const principal = await authenticate(c);
    return c.json(envelope(await getTenant(c.get("container"), principal)));
  });

  v1.post("/tenant/deletion", async (c) => {
    const principal = await authenticate(c);
    assertCsrf(c, principal);
    const tenantId = await requestTenantDeletion(c.get("container"), principal);
    const job = await requestDeletion(c.get("container"), principal, "all");
    return c.json(envelope({ tenantId, jobId: job.id }));
  });

  v1.get("/api-keys", async (c) => {
    const principal = await authenticate(c);
    return c.json(envelope(await listApiKeys(c.get("container"), principal)));
  });

  v1.post("/api-keys", async (c) => {
    const principal = await authenticate(c);
    assertCsrf(c, principal);
    const body = await c.req.json<{ name: string; scopes: string[]; expiresAt?: number | null }>();
    const created = await createApiKey(c.get("container"), principal, {
      name: body.name,
      scopes: body.scopes,
      expiresAt: body.expiresAt ?? null,
    });
    return c.json(envelope(created), 201);
  });

  v1.delete("/api-keys/:id", async (c) => {
    const principal = await authenticate(c);
    assertCsrf(c, principal);
    await revokeApiKey(c.get("container"), principal, c.req.param("id"));
    return c.json(envelope({ ok: true }));
  });

  v1.post("/api-keys/:id/rotate", async (c) => {
    const principal = await authenticate(c);
    assertCsrf(c, principal);
    return c.json(envelope(await rotateApiKey(c.get("container"), principal, c.req.param("id"))));
  });

  v1.get("/log-streams", async (c) => {
    const principal = await authenticate(c);
    return c.json(envelope(await listStreams(c.get("container").streams, principal)));
  });

  v1.get("/log-streams/:id", async (c) => {
    const principal = await authenticate(c);
    return c.json(
      envelope(await getStream(c.get("container").streams, principal, c.req.param("id"))),
    );
  });

  v1.post("/logs/ingest", async (c) => {
    const principal = await authenticate(c);
    await enforceIngestRateLimit(c.env, principal.tenantId, c.req.header("cf-connecting-ip"));
    const body = await c.req.json<{ events: Parameters<typeof ingestLogs>[2] }>();
    return c.json(envelope(await ingestLogs(c.get("container"), principal, body.events)), 202);
  });

  v1.post("/logs/query", async (c) => {
    const principal = await authenticate(c);
    await enforceQueryRateLimit(c.env, principal.tenantId);
    const body = await c.req.json<{ query: string; start: number; end: number; limit?: number }>();
    return c.json(envelope(await runLogQuery(c.get("container"), principal, body)));
  });

  v1.get("/logs/tail", async (c) => {
    const principal = await authenticate(c);
    const id = c.env.REALTIME_HUB.idFromName(`tenant:${principal.tenantId}`);
    const stub = c.env.REALTIME_HUB.get(id);
    return stub.fetch(
      `https://realtime/tail?filter=${encodeURIComponent(c.req.query("filter") ?? "")}`,
    );
  });

  v1.post("/metrics/ingest", async (c) => {
    const principal = await authenticate(c);
    await enforceIngestRateLimit(c.env, principal.tenantId, c.req.header("cf-connecting-ip"));
    const body = await c.req.json<{ events: Parameters<typeof ingestMetrics>[2] }>();
    return c.json(envelope(await ingestMetrics(c.get("container"), principal, body.events)), 202);
  });

  v1.post("/metrics/query", async (c) => {
    const principal = await authenticate(c);
    await enforceQueryRateLimit(c.env, principal.tenantId);
    const body = await c.req.json<{
      query: string;
      start: number;
      end: number;
      stepMs?: number;
    }>();
    const container = c.get("container");
    return c.json(
      envelope(
        await runMetricQuery(
          {
            clock: container.clock,
            series: container.series,
            metricChunks: container.metricChunks,
            objects: container.objects,
            compressor: container.compressor,
          },
          principal,
          body,
        ),
      ),
    );
  });

  v1.get("/metrics", async (c) => {
    const principal = await authenticate(c);
    return c.json(
      envelope(
        await listMetricSeries(c.get("container").series, principal, c.req.query("name") ?? null),
      ),
    );
  });

  v1.post("/traces/ingest", async (c) => {
    const principal = await authenticate(c);
    await enforceIngestRateLimit(c.env, principal.tenantId, c.req.header("cf-connecting-ip"));
    const body = await c.req.json<{ events: Parameters<typeof ingestTraces>[2] }>();
    return c.json(envelope(await ingestTraces(c.get("container"), principal, body.events)), 202);
  });

  v1.get("/traces", async (c) => {
    const principal = await authenticate(c);
    const start = Number(c.req.query("start") ?? c.get("container").clock.now() - 3_600_000);
    const end = Number(c.req.query("end") ?? c.get("container").clock.now());
    return c.json(
      envelope(
        await searchTraces(c.get("container").traces, principal, {
          start,
          end,
          service: c.req.query("service") ?? undefined,
          operation: c.req.query("operation") ?? undefined,
          status: (c.req.query("status") as "ok" | "error" | undefined) ?? undefined,
          minDurationMs: c.req.query("minDurationMs")
            ? Number(c.req.query("minDurationMs"))
            : undefined,
        }),
      ),
    );
  });

  v1.get("/traces/:traceId", async (c) => {
    const principal = await authenticate(c);
    return c.json(envelope(await getTrace(c.get("container"), principal, c.req.param("traceId"))));
  });

  v1.get("/dashboards", async (c) => {
    const principal = await authenticate(c);
    return c.json(envelope(await listDashboards(c.get("container").dashboards, principal)));
  });

  v1.post("/dashboards", async (c) => {
    const principal = await authenticate(c);
    assertCsrf(c, principal);
    const body = await c.req.json<{
      name: string;
      description?: string;
      definition: { widgets: [] };
    }>();
    return c.json(
      envelope(
        await saveDashboard(c.get("container"), principal, {
          name: body.name,
          description: body.description ?? "",
          definition: body.definition,
        }),
      ),
      201,
    );
  });

  v1.get("/dashboards/:id", async (c) => {
    const principal = await authenticate(c);
    return c.json(
      envelope(await getDashboard(c.get("container").dashboards, principal, c.req.param("id"))),
    );
  });

  v1.put("/dashboards/:id", async (c) => {
    const principal = await authenticate(c);
    assertCsrf(c, principal);
    const body = await c.req.json<{
      name: string;
      description?: string;
      definition: { widgets: [] };
    }>();
    return c.json(
      envelope(
        await saveDashboard(c.get("container"), principal, {
          id: c.req.param("id"),
          name: body.name,
          description: body.description ?? "",
          definition: body.definition,
        }),
      ),
    );
  });

  v1.delete("/dashboards/:id", async (c) => {
    const principal = await authenticate(c);
    assertCsrf(c, principal);
    await deleteDashboard(c.get("container").dashboards, principal, c.req.param("id"));
    return c.json(envelope({ ok: true }));
  });

  v1.get("/alerts", async (c) => {
    const principal = await authenticate(c);
    return c.json(envelope(await listAlerts(c.get("container").alerts, principal)));
  });

  v1.post("/alerts", async (c) => {
    const principal = await authenticate(c);
    assertCsrf(c, principal);
    const body = await c.req.json<{
      name: string;
      query: string;
      kind: AlertKind;
      threshold: number;
      comparator: AlertComparator;
      windowSeconds: number;
      forSeconds?: number;
      webhookUrl?: string | null;
      enabled?: boolean;
    }>();
    return c.json(
      envelope(
        await saveAlert(c.get("container"), principal, { ...body, enabled: body.enabled ?? true }),
      ),
      201,
    );
  });

  v1.get("/alerts/:id/state", async (c) => {
    const principal = await authenticate(c);
    return c.json(
      envelope(await getAlertState(c.get("container").alerts, principal, c.req.param("id"))),
    );
  });

  v1.get("/alerts/:id/events", async (c) => {
    const principal = await authenticate(c);
    return c.json(
      envelope(
        await listAlertEvents(
          c.get("container").alerts,
          principal,
          c.req.param("id"),
          Number(c.req.query("limit") ?? 50),
        ),
      ),
    );
  });

  v1.get("/alerts/:id", async (c) => {
    const principal = await authenticate(c);
    const alerts = await listAlerts(c.get("container").alerts, principal);
    const alert = alerts.find((a) => a.id === c.req.param("id"));
    if (!alert) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Alert not found.", 404);
    }
    return c.json(envelope(alert));
  });

  v1.put("/alerts/:id", async (c) => {
    const principal = await authenticate(c);
    assertCsrf(c, principal);
    const body = await c.req.json<{
      name: string;
      query: string;
      kind: AlertKind;
      threshold: number;
      comparator: AlertComparator;
      windowSeconds: number;
      forSeconds?: number;
      webhookUrl?: string | null;
      enabled: boolean;
    }>();
    return c.json(
      envelope(await saveAlert(c.get("container"), principal, { id: c.req.param("id"), ...body })),
    );
  });

  v1.delete("/alerts/:id", async (c) => {
    const principal = await authenticate(c);
    assertCsrf(c, principal);
    await deleteAlert(c.get("container").alerts, principal, c.req.param("id"));
    return c.json(envelope({ ok: true }));
  });

  v1.get("/alert-silences", async (c) => {
    const principal = await authenticate(c);
    return c.json(envelope(await listSilences(c.get("container").alerts, principal)));
  });

  v1.post("/alert-silences", async (c) => {
    const principal = await authenticate(c);
    assertCsrf(c, principal);
    const body = await c.req.json<{
      alertId?: string | null;
      startsAt: number;
      endsAt: number;
      comment?: string;
    }>();
    return c.json(envelope(await createSilence(c.get("container"), principal, body)), 201);
  });

  v1.delete("/alert-silences/:id", async (c) => {
    const principal = await authenticate(c);
    assertCsrf(c, principal);
    await deleteSilence(c.get("container").alerts, principal, c.req.param("id"));
    return c.json(envelope({ ok: true }));
  });

  v1.post("/buffer/enqueue", async (c) => {
    const principal = await authenticate(c);
    await enforceIngestRateLimit(c.env, principal.tenantId, c.req.header("cf-connecting-ip"));
    const body = await c.req.json<{
      items: Array<{
        kind: "logs" | "metrics" | "traces";
        payload: unknown;
        eventId?: string;
      }>;
    }>();
    const now = c.get("container").clock.now();
    const items = (body.items ?? []).slice(0, 100).map((it) => ({
      kind: it.kind,
      tenantId: principal.tenantId,
      payload: it.payload,
      eventId: it.eventId ?? c.get("container").ids.id(),
      receivedAt: now,
    }));
    if (items.length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "At least one item is required.", 400);
    }
    const id = c.env.INGEST_BUFFER.idFromName(principal.tenantId);
    const stub = c.env.INGEST_BUFFER.get(id);
    const res = await stub.fetch("https://ingest-buffer/enqueue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const data = await res.json();
    return c.json(envelope(data), 202);
  });

  v1.get("/retention", async (c) => {
    const principal = await authenticate(c);
    return c.json(envelope(await getRetention(c.get("container").retention, principal)));
  });

  v1.put("/retention", async (c) => {
    const principal = await authenticate(c);
    assertCsrf(c, principal);
    const body = await c.req.json<{ logsDays: number; metricsDays: number; tracesDays: number }>();
    return c.json(envelope(await updateRetention(c.get("container"), principal, body)));
  });

  v1.post("/data-deletion", async (c) => {
    const principal = await authenticate(c);
    assertCsrf(c, principal);
    const body = await c.req.json<{ target: DeletionTarget }>();
    return c.json(envelope(await requestDeletion(c.get("container"), principal, body.target)), 202);
  });

  v1.get("/data-deletion", async (c) => {
    const principal = await authenticate(c);
    return c.json(envelope(await listDeletionJobs(c.get("container").jobs, principal)));
  });

  v1.get("/data-deletion/:id", async (c) => {
    const principal = await authenticate(c);
    return c.json(
      envelope(await getDeletionJob(c.get("container").jobs, principal, c.req.param("id"))),
    );
  });

  v1.get("/apm/overview", async (c) => {
    const principal = await authenticate(c);
    const now = c.get("container").clock.now();
    return c.json(
      envelope(
        await apmOverview(
          c.get("container").apm,
          principal,
          Number(c.req.query("start") ?? now - 3_600_000),
          Number(c.req.query("end") ?? now),
        ),
      ),
    );
  });

  v1.get("/apm/services", async (c) => {
    const principal = await authenticate(c);
    const now = c.get("container").clock.now();
    const overview = await apmOverview(
      c.get("container").apm,
      principal,
      Number(c.req.query("start") ?? now - 3_600_000),
      Number(c.req.query("end") ?? now),
    );
    return c.json(envelope(overview.services));
  });

  v1.get("/apm/endpoints", async (c) => {
    const principal = await authenticate(c);
    const now = c.get("container").clock.now();
    return c.json(
      envelope(
        await apmEndpoints(
          c.get("container").apm,
          principal,
          Number(c.req.query("start") ?? now - 3_600_000),
          Number(c.req.query("end") ?? now),
          c.req.query("service") ?? null,
        ),
      ),
    );
  });

  v1.get("/apm/service-map", async (c) => {
    const principal = await authenticate(c);
    const now = c.get("container").clock.now();
    return c.json(
      envelope(
        await apmServiceMap(
          c.get("container").apm,
          principal,
          Number(c.req.query("start") ?? now - 3_600_000),
          Number(c.req.query("end") ?? now),
        ),
      ),
    );
  });

  v1.get("/usage", async (c) => {
    const principal = await authenticate(c);
    const now = c.get("container").clock.now();
    return c.json(
      envelope(
        await getUsage(
          c.get("container").usage,
          principal,
          Number(c.req.query("start") ?? now - 86_400_000),
          Number(c.req.query("end") ?? now),
        ),
      ),
    );
  });

  v1.get("/audit", async (c) => {
    const principal = await authenticate(c);
    return c.json(
      envelope(
        await listAudit(
          c.get("container").audit,
          principal,
          Number(c.req.query("limit") ?? 50),
          c.req.query("cursor") ?? null,
        ),
      ),
    );
  });

  app.route("/api/v1", v1);

  const otlp = new Hono<AppEnv>();
  otlp.post("/logs", async (c) => {
    const principal = await authenticate(c);
    await enforceIngestRateLimit(c.env, principal.tenantId, c.req.header("cf-connecting-ip"));
    const ct = c.req.header("content-type");
    const body = isProtobufContentType(ct)
      ? decodeOtlpLogsProto(new Uint8Array(await c.req.arrayBuffer()))
      : await c.req.json();
    const events = mapOtlpLogs(body as Parameters<typeof mapOtlpLogs>[0]);
    if (events.length === 0) return c.json(envelope({ accepted: 0, eventIds: [] }), 202);
    return c.json(envelope(await ingestLogs(c.get("container"), principal, events)), 202);
  });
  otlp.post("/traces", async (c) => {
    const principal = await authenticate(c);
    await enforceIngestRateLimit(c.env, principal.tenantId, c.req.header("cf-connecting-ip"));
    const ct = c.req.header("content-type");
    const body = isProtobufContentType(ct)
      ? decodeOtlpTracesProto(new Uint8Array(await c.req.arrayBuffer()))
      : await c.req.json();
    const events = mapOtlpTraces(body as Parameters<typeof mapOtlpTraces>[0]);
    if (events.length === 0) return c.json(envelope({ accepted: 0, eventIds: [] }), 202);
    return c.json(envelope(await ingestTraces(c.get("container"), principal, events)), 202);
  });
  otlp.post("/metrics", async (c) => {
    const principal = await authenticate(c);
    await enforceIngestRateLimit(c.env, principal.tenantId, c.req.header("cf-connecting-ip"));
    const ct = c.req.header("content-type");
    const body = isProtobufContentType(ct)
      ? decodeOtlpMetricsProto(new Uint8Array(await c.req.arrayBuffer()))
      : await c.req.json();
    const events = mapOtlpMetrics(body as Parameters<typeof mapOtlpMetrics>[0]);
    if (events.length === 0) return c.json(envelope({ accepted: 0, eventIds: [] }), 202);
    return c.json(envelope(await ingestMetrics(c.get("container"), principal, events)), 202);
  });
  app.route("/v1", otlp);
  app.route("/api/v1/otlp/v1", otlp);

  return app;
}
