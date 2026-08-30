import type { Container } from "./container.js";
import {
  MemoryWorld,
  memoryAlertRepo,
  memoryApiKeyRepo,
  memoryApmRepo,
  memoryAttemptsRepo,
  memoryAuditRepo,
  memoryCache,
  memoryDashboardRepo,
  memoryDedup,
  memoryJobRepo,
  memoryLogChunkRepo,
  memoryMembershipRepo,
  memoryMetricChunkRepo,
  memoryObjects,
  memoryQueue,
  memoryRealtime,
  memoryRetentionRepo,
  memorySeriesRepo,
  memorySessionRepo,
  memoryStreamRepo,
  memoryTenantRepo,
  memoryTraceRepo,
  memoryUsageRepo,
  memoryUserRepo,
} from "../infrastructure/memory/world.js";
import {
  createChecksum,
  createIdGenerator,
  createTokenHasher,
} from "../infrastructure/crypto/web-crypto.js";
import type { PasswordHasher } from "../application/ports.js";

function testPasswordHasher(): PasswordHasher {
  return {
    async hash(password: string) {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`test:${password}`),
      );
      const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      return { hash, salt: "test" };
    },
    async verify(password: string, hash: string, salt: string) {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`test:${password}`),
      );
      const actual = [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return actual === hash && salt === "test";
    },
  };
}
import { nodeCompressor } from "../infrastructure/crypto/node-compress.js";
import { silentMetrics } from "../infrastructure/cloudflare/adapters.js";

export function createMemoryContainer(now = Date.now()): {
  world: MemoryWorld;
  container: Container;
} {
  const world = new MemoryWorld();
  const clock = { now: () => now };
  const streams = memoryStreamRepo(world);
  const chunks = memoryLogChunkRepo(world);
  const container: Container = {
    clock,
    ids: createIdGenerator(),
    passwords: testPasswordHasher(),
    tokens: createTokenHasher(),
    users: memoryUserRepo(world),
    sessions: memorySessionRepo(world),
    tenants: memoryTenantRepo(world),
    memberships: memoryMembershipRepo(world),
    apiKeys: memoryApiKeyRepo(world),
    attempts: memoryAttemptsRepo(world),
    audit: memoryAuditRepo(world),
    retention: memoryRetentionRepo(world),
    cache: memoryCache(world, () => now),
    sessionTtlSeconds: 43200,
    queue: memoryQueue(world),
    usage: memoryUsageRepo(world),
    streams,
    chunks,
    objects: memoryObjects(world),
    compressor: nodeCompressor(),
    metrics: silentMetrics(),
    dedup: memoryDedup(world),
    series: memorySeriesRepo(world),
    metricChunks: memoryMetricChunkRepo(world),
    traces: memoryTraceRepo(world),
    checksum: createChecksum(),
    realtime: memoryRealtime(world),
    apm: memoryApmRepo(world),
    logChunks: chunks,
    jobs: memoryJobRepo(world),
    dashboards: memoryDashboardRepo(world),
    alerts: memoryAlertRepo(world),
  };
  return { world, container };
}
