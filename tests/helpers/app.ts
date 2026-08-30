import { createApp } from "../../src/presentation/http/app.js";
import { createMemoryContainer } from "../../src/composition/memory-container.js";
import type { Env } from "../../src/env.js";
import type { Container } from "../../src/composition/container.js";

export function testEnv(): Env {
  return {
    DB: {
      prepare: () => ({
        first: async () => ({ 1: 1 }),
        bind() {
          return this;
        },
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 0 } }),
      }),
    } as unknown as D1Database,
    TELEMETRY: {} as R2Bucket,
    KV: {} as KVNamespace,
    INGEST_QUEUE: { send: async () => undefined } as unknown as Queue,
    DELETION_QUEUE: { send: async () => undefined } as unknown as Queue,
    REALTIME_HUB: {
      idFromName: () => ({}) as DurableObjectId,
      get: () => ({
        fetch: async () =>
          new Response("event: ready\n\n", { headers: { "content-type": "text/event-stream" } }),
      }),
    } as unknown as DurableObjectNamespace,
    ALERT_COORDINATOR: {} as DurableObjectNamespace,
    INGEST_BUFFER: {
      idFromName: () => ({}) as DurableObjectId,
      get: () => ({
        fetch: async () => Response.json({ queued: 1 }),
      }),
    } as unknown as DurableObjectNamespace,
    ENVIRONMENT: "test",
    SESSION_TTL_SECONDS: "43200",
    SESSION_COOKIE_NAME: "oe_session",
    ALLOWED_ORIGINS: "http://localhost:5173",
  };
}

export function testApp(now = Date.now()): {
  app: ReturnType<typeof createApp>;
  container: Container;
  env: Env;
} {
  const { container } = createMemoryContainer(now);
  const app = createApp(() => container);
  return { app, container, env: testEnv() };
}

function cookieList(headers: Headers): string[] {
  const getSet = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSet === "function") {
    return getSet.call(headers);
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

export async function json(
  app: ReturnType<typeof createApp>,
  env: Env,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{
  status: number;
  body: { data: unknown; error: { code: string; message: string } | null };
  cookies: string[];
}> {
  const res = await app.request(
    path,
    {
      method,
      headers: {
        "content-type": "application/json",
        "x-open-edge-csrf": "1",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
  return {
    status: res.status,
    body: (await res.json()) as { data: unknown; error: { code: string; message: string } | null },
    cookies: cookieList(res.headers),
  };
}
