import type { AuthDeps } from "../application/identity/auth.js";
import type { ConsumeDeps } from "../application/ingestion/consume.js";
import type { IngestDeps } from "../application/ingestion/ingest.js";
import type { QueryDeps } from "../application/query/run-log-query.js";
import type { DeletionDeps } from "../application/deletion/process.js";
import type { TenantDeps } from "../application/tenant/members.js";
import type { Env } from "../env.js";
import {
  d1Alerts,
  d1ApiKeys,
  d1Apm,
  d1Attempts,
  d1Audit,
  d1Dashboards,
  d1Dedup,
  d1Jobs,
  d1LogChunks,
  d1Memberships,
  d1MetricChunks,
  d1Retention,
  d1Series,
  d1Sessions,
  d1Streams,
  d1Tenants,
  d1Traces,
  d1Usage,
  d1Users,
} from "../infrastructure/d1/repositories.js";
import {
  createChecksum,
  createIdGenerator,
  createPasswordHasher,
  createTokenHasher,
  systemClock,
} from "../infrastructure/crypto/web-crypto.js";
import { streamsCompressor } from "../infrastructure/crypto/compress.js";
import {
  kvCache,
  queuePort,
  r2Store,
  realtimePort,
  silentMetrics,
} from "../infrastructure/cloudflare/adapters.js";

export interface Container
  extends AuthDeps, TenantDeps, IngestDeps, QueryDeps, ConsumeDeps, DeletionDeps {
  readonly dashboards: ReturnType<typeof d1Dashboards>;
  readonly alerts: ReturnType<typeof d1Alerts>;
  readonly apm: ReturnType<typeof d1Apm>;
  readonly jobs: ReturnType<typeof d1Jobs>;
  readonly objects: ReturnType<typeof r2Store>;
}

export function createContainer(env: Env): Container {
  const clock = systemClock();
  const ids = createIdGenerator();
  return {
    clock,
    ids,
    passwords: createPasswordHasher(),
    tokens: createTokenHasher(),
    users: d1Users(env.DB),
    sessions: d1Sessions(env.DB),
    tenants: d1Tenants(env.DB),
    memberships: d1Memberships(env.DB),
    apiKeys: d1ApiKeys(env.DB),
    attempts: d1Attempts(env.DB),
    audit: d1Audit(env.DB),
    retention: d1Retention(env.DB),
    cache: kvCache(env.KV),
    sessionTtlSeconds: Number(env.SESSION_TTL_SECONDS || 43200),
    queue: queuePort(env),
    usage: d1Usage(env.DB),
    streams: d1Streams(env.DB),
    chunks: d1LogChunks(env.DB),
    objects: r2Store(env.TELEMETRY),
    compressor: streamsCompressor(),
    metrics: silentMetrics(),
    dedup: d1Dedup(env.DB),
    series: d1Series(env.DB),
    metricChunks: d1MetricChunks(env.DB),
    traces: d1Traces(env.DB),
    checksum: createChecksum(),
    realtime: realtimePort(env),
    apm: d1Apm(env.DB),
    logChunks: d1LogChunks(env.DB),
    jobs: d1Jobs(env.DB),
    dashboards: d1Dashboards(env.DB),
    alerts: d1Alerts(env.DB),
  };
}
