import type { User } from "../../domain/identity/user.js";
import type { Session } from "../../domain/identity/session.js";
import type { ApiKey } from "../../domain/identity/api-key.js";
import type { ApiKeyScope, Role } from "../../domain/identity/permissions.js";
import type { Membership, Tenant, TenantStatus } from "../../domain/tenant/tenant.js";
import { createLabelSet } from "../../domain/logs/labels.js";
import type { ChunkStatus, LogChunk, LogStream } from "../../domain/logs/log-stream.js";
import type { MetricChunk, MetricSeries, MetricType } from "../../domain/metrics/metric.js";
import type { SpanStatus, Trace } from "../../domain/tracing/trace.js";
import type { Dashboard, DashboardDefinition } from "../../domain/dashboard/dashboard.js";
import type {
  Alert,
  AlertComparator,
  AlertEvent,
  AlertKind,
  AlertStateStatus,
} from "../../domain/alerting/alert.js";
import type { AlertSilence } from "../../domain/alerting/silence.js";
import type { RetentionPolicy } from "../../domain/retention/policy.js";
import type {
  DeletionJob,
  DeletionKind,
  DeletionStatus,
  DeletionTarget,
} from "../../domain/deletion/job.js";
import type { AuditEvent } from "../../domain/audit/audit-event.js";
import type { UsageRecord } from "../../domain/usage/usage-record.js";
import type { EndpointStats } from "../../domain/apm/stats.js";
import { mergeLatencyHist, parseHistJson } from "../../domain/apm/histogram.js";
import type { ServiceEdge } from "../../domain/apm/service-edge.js";
import type {
  ApiKeyRepository,
  ApmRepository,
  AuditRepository,
  DedupRepository,
  DeletionJobRepository,
  LogChunkRepository,
  LogStreamRepository,
  LoginAttemptRepository,
  MembershipRepository,
  MetricChunkRepository,
  MetricSeriesRepository,
  RetentionRepository,
  SessionRepository,
  TenantRepository,
  TraceRepository,
  UsageRepository,
  UserRepository,
  DashboardRepository,
  AlertRepository,
} from "../../application/ports.js";
import {
  asApiKeyId,
  asAlertId,
  asDashboardId,
  asDeletionJobId,
  asSessionId,
  asSeriesId,
  asStreamId,
  asTenantId,
  asTraceId,
  asUserId,
} from "../../shared/ids.js";

function n(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function s(value: unknown): string {
  return String(value);
}

export function d1Users(db: D1Database): UserRepository {
  return {
    async findById(id) {
      const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
      return row ? mapUser(row) : null;
    },
    async findByEmail(email) {
      const row = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
      return row ? mapUser(row) : null;
    },
    async save(user) {
      await db
        .prepare(
          `INSERT INTO users (id, email, password_hash, password_salt, display_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             email=excluded.email, password_hash=excluded.password_hash, password_salt=excluded.password_salt,
             display_name=excluded.display_name, updated_at=excluded.updated_at`,
        )
        .bind(
          user.id,
          user.email,
          user.passwordHash,
          user.passwordSalt,
          user.displayName,
          user.createdAt,
          user.updatedAt,
        )
        .run();
    },
  };
}

function mapUser(row: Record<string, unknown>): User {
  return {
    id: asUserId(s(row.id)),
    email: s(row.email),
    passwordHash: s(row.password_hash),
    passwordSalt: s(row.password_salt),
    displayName: s(row.display_name),
    createdAt: n(row.created_at),
    updatedAt: n(row.updated_at),
  };
}

export function d1Tenants(db: D1Database): TenantRepository {
  return {
    async findById(id) {
      const row = await db.prepare("SELECT * FROM tenants WHERE id = ?").bind(id).first();
      return row ? mapTenant(row) : null;
    },
    async findBySlug(slug) {
      const row = await db.prepare("SELECT * FROM tenants WHERE slug = ?").bind(slug).first();
      return row ? mapTenant(row) : null;
    },
    async save(tenant) {
      await db
        .prepare(
          `INSERT INTO tenants (id, name, slug, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, slug=excluded.slug, status=excluded.status, updated_at=excluded.updated_at`,
        )
        .bind(
          tenant.id,
          tenant.name,
          tenant.slug,
          tenant.status,
          tenant.createdAt,
          tenant.updatedAt,
        )
        .run();
    },
  };
}

function mapTenant(row: Record<string, unknown>): Tenant {
  return {
    id: asTenantId(s(row.id)),
    name: s(row.name),
    slug: s(row.slug),
    status: s(row.status) as TenantStatus,
    createdAt: n(row.created_at),
    updatedAt: n(row.updated_at),
  };
}

export function d1Memberships(db: D1Database): MembershipRepository {
  return {
    async find(tenantId, userId) {
      const row = await db
        .prepare("SELECT * FROM tenant_memberships WHERE tenant_id = ? AND user_id = ?")
        .bind(tenantId, userId)
        .first();
      return row ? mapMembership(row) : null;
    },
    async listByTenant(tenantId) {
      const res = await db
        .prepare("SELECT * FROM tenant_memberships WHERE tenant_id = ?")
        .bind(tenantId)
        .all();
      return (res.results ?? []).map((r) => mapMembership(r as Record<string, unknown>));
    },
    async listByUser(userId) {
      const res = await db
        .prepare("SELECT * FROM tenant_memberships WHERE user_id = ?")
        .bind(userId)
        .all();
      return (res.results ?? []).map((r) => mapMembership(r as Record<string, unknown>));
    },
    async save(membership) {
      await db
        .prepare(
          `INSERT INTO tenant_memberships (tenant_id, user_id, role, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(tenant_id, user_id) DO UPDATE SET role=excluded.role`,
        )
        .bind(membership.tenantId, membership.userId, membership.role, membership.createdAt)
        .run();
    },
    async delete(tenantId, userId) {
      await db
        .prepare("DELETE FROM tenant_memberships WHERE tenant_id = ? AND user_id = ?")
        .bind(tenantId, userId)
        .run();
    },
  };
}

function mapMembership(row: Record<string, unknown>): Membership {
  return {
    tenantId: asTenantId(s(row.tenant_id)),
    userId: asUserId(s(row.user_id)),
    role: s(row.role) as Role,
    createdAt: n(row.created_at),
  };
}

export function d1Sessions(db: D1Database): SessionRepository {
  return {
    async findById(id) {
      const row = await db.prepare("SELECT * FROM sessions WHERE id = ?").bind(id).first();
      return row ? mapSession(row) : null;
    },
    async findByTokenHash(tokenHash) {
      const row = await db
        .prepare("SELECT * FROM sessions WHERE token_hash = ?")
        .bind(tokenHash)
        .first();
      return row ? mapSession(row) : null;
    },
    async listByUser(userId) {
      const res = await db
        .prepare(
          `SELECT * FROM sessions
           WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
           ORDER BY created_at DESC LIMIT 50`,
        )
        .bind(userId, Date.now())
        .all();
      return (res.results ?? []).map((r) => mapSession(r as Record<string, unknown>));
    },
    async save(session) {
      await db
        .prepare(
          `INSERT INTO sessions (id, user_id, tenant_id, token_hash, created_at, expires_at, last_seen_at, revoked_at, rotated_from, user_agent, ip_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at, revoked_at=excluded.revoked_at`,
        )
        .bind(
          session.id,
          session.userId,
          session.tenantId,
          session.tokenHash,
          session.createdAt,
          session.expiresAt,
          session.lastSeenAt,
          session.revokedAt,
          session.rotatedFrom,
          session.userAgent,
          session.ipHash,
        )
        .run();
    },
    async revokeAllForUser(userId, now) {
      const res = await db
        .prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
        .bind(now, userId)
        .run();
      return res.meta.changes ?? 0;
    },
    async revokeAllForTenant(tenantId, now) {
      const res = await db
        .prepare("UPDATE sessions SET revoked_at = ? WHERE tenant_id = ? AND revoked_at IS NULL")
        .bind(now, tenantId)
        .run();
      return res.meta.changes ?? 0;
    },
  };
}

function mapSession(row: Record<string, unknown>): Session {
  return {
    id: asSessionId(s(row.id)),
    userId: asUserId(s(row.user_id)),
    tenantId: asTenantId(s(row.tenant_id)),
    tokenHash: s(row.token_hash),
    createdAt: n(row.created_at),
    expiresAt: n(row.expires_at),
    lastSeenAt: n(row.last_seen_at),
    revokedAt: row.revoked_at === null ? null : n(row.revoked_at),
    rotatedFrom: row.rotated_from === null ? null : asSessionId(s(row.rotated_from)),
    userAgent: row.user_agent === null ? null : s(row.user_agent),
    ipHash: row.ip_hash === null ? null : s(row.ip_hash),
  };
}

export function d1ApiKeys(db: D1Database): ApiKeyRepository {
  return {
    async findById(tenantId, id) {
      const row = await db
        .prepare("SELECT * FROM api_keys WHERE tenant_id = ? AND id = ?")
        .bind(tenantId, id)
        .first();
      return row ? mapApiKey(row) : null;
    },
    async findByHash(keyHash) {
      const row = await db
        .prepare("SELECT * FROM api_keys WHERE key_hash = ?")
        .bind(keyHash)
        .first();
      return row ? mapApiKey(row) : null;
    },
    async listByTenant(tenantId) {
      const res = await db
        .prepare(
          `SELECT * FROM api_keys
           WHERE tenant_id = ? AND revoked_at IS NULL
           ORDER BY created_at DESC LIMIT 100`,
        )
        .bind(tenantId)
        .all();
      return (res.results ?? []).map((r) => mapApiKey(r as Record<string, unknown>));
    },
    async save(key) {
      await db
        .prepare(
          `INSERT INTO api_keys (id, tenant_id, name, key_hash, key_prefix, scopes, created_by, created_at, expires_at, revoked_at, last_used_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET revoked_at=excluded.revoked_at, last_used_at=excluded.last_used_at`,
        )
        .bind(
          key.id,
          key.tenantId,
          key.name,
          key.keyHash,
          key.keyPrefix,
          JSON.stringify(key.scopes),
          key.createdBy,
          key.createdAt,
          key.expiresAt,
          key.revokedAt,
          key.lastUsedAt,
        )
        .run();
    },
    async revokeAllForTenant(tenantId, now) {
      const res = await db
        .prepare("UPDATE api_keys SET revoked_at = ? WHERE tenant_id = ? AND revoked_at IS NULL")
        .bind(now, tenantId)
        .run();
      return res.meta.changes ?? 0;
    },
  };
}

function mapApiKey(row: Record<string, unknown>): ApiKey {
  return {
    id: asApiKeyId(s(row.id)),
    tenantId: asTenantId(s(row.tenant_id)),
    name: s(row.name),
    keyHash: s(row.key_hash),
    keyPrefix: s(row.key_prefix),
    scopes: JSON.parse(s(row.scopes)) as ApiKeyScope[],
    createdBy: asUserId(s(row.created_by)),
    createdAt: n(row.created_at),
    expiresAt: row.expires_at === null ? null : n(row.expires_at),
    revokedAt: row.revoked_at === null ? null : n(row.revoked_at),
    lastUsedAt: row.last_used_at === null ? null : n(row.last_used_at),
  };
}

export function d1Attempts(db: D1Database): LoginAttemptRepository {
  return {
    async record(emailHash, ipHash, succeeded, createdAt) {
      await db
        .prepare(
          "INSERT INTO login_attempts (id, email_hash, ip_hash, succeeded, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(crypto.randomUUID(), emailHash, ipHash, succeeded ? 1 : 0, createdAt)
        .run();
    },
    async countRecentFailures(emailHash, ipHash, since) {
      const row = await db
        .prepare(
          "SELECT COUNT(*) as c FROM login_attempts WHERE succeeded = 0 AND created_at >= ? AND (email_hash = ? OR ip_hash = ?)",
        )
        .bind(since, emailHash, ipHash)
        .first<{ c: number }>();
      return n(row?.c ?? 0);
    },
  };
}

export function d1Streams(db: D1Database): LogStreamRepository {
  return {
    async findByFingerprint(tenantId, fingerprint) {
      const row = await db
        .prepare("SELECT * FROM log_streams WHERE tenant_id = ? AND fingerprint = ?")
        .bind(tenantId, fingerprint)
        .first();
      return row ? mapStream(row) : null;
    },
    async findById(tenantId, id) {
      const row = await db
        .prepare("SELECT * FROM log_streams WHERE tenant_id = ? AND id = ?")
        .bind(tenantId, id)
        .first();
      return row ? mapStream(row) : null;
    },
    async listByTenant(tenantId, limit) {
      const res = await db
        .prepare("SELECT * FROM log_streams WHERE tenant_id = ? ORDER BY last_seen_at DESC LIMIT ?")
        .bind(tenantId, limit)
        .all();
      return (res.results ?? []).map((r) => mapStream(r as Record<string, unknown>));
    },
    async countByTenant(tenantId) {
      const row = await db
        .prepare("SELECT COUNT(*) as c FROM log_streams WHERE tenant_id = ?")
        .bind(tenantId)
        .first<{ c: number }>();
      return n(row?.c ?? 0);
    },
    async save(stream) {
      await db
        .prepare(
          `INSERT INTO log_streams (id, tenant_id, fingerprint, labels_json, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at`,
        )
        .bind(
          stream.id,
          stream.tenantId,
          stream.fingerprint,
          JSON.stringify(stream.labels.entries),
          stream.createdAt,
          stream.lastSeenAt,
        )
        .run();
    },
  };
}

function mapStream(row: Record<string, unknown>): LogStream {
  return {
    id: asStreamId(s(row.id)),
    tenantId: asTenantId(s(row.tenant_id)),
    fingerprint: s(row.fingerprint),
    labels: createLabelSet(JSON.parse(s(row.labels_json)) as Record<string, string>),
    createdAt: n(row.created_at),
    lastSeenAt: n(row.last_seen_at),
  };
}

export function d1LogChunks(db: D1Database): LogChunkRepository {
  return {
    async save(chunk) {
      await db
        .prepare(
          `INSERT INTO log_chunks (id, tenant_id, stream_id, start_time, end_time, entry_count, compressed_size, checksum, object_key, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET status=excluded.status`,
        )
        .bind(
          chunk.id,
          chunk.tenantId,
          chunk.streamId,
          chunk.startTime,
          chunk.endTime,
          chunk.entryCount,
          chunk.compressedSize,
          chunk.checksum,
          chunk.objectKey,
          chunk.status,
          chunk.createdAt,
        )
        .run();
    },
    async listInRange(tenantId, streamIds, start, end) {
      if (streamIds.length === 0) return [];
      const placeholders = streamIds.map(() => "?").join(",");
      const res = await db
        .prepare(
          `SELECT * FROM log_chunks WHERE tenant_id = ? AND stream_id IN (${placeholders}) AND end_time >= ? AND start_time <= ? AND status = 'ready' LIMIT 200`,
        )
        .bind(tenantId, ...streamIds, start, end)
        .all();
      return (res.results ?? []).map((r) => mapLogChunk(r as Record<string, unknown>));
    },
    async listExpired(tenantId, before, afterId, limit) {
      const res = await db
        .prepare(
          `SELECT * FROM log_chunks WHERE tenant_id = ? AND end_time < ? AND (? IS NULL OR id > ?) ORDER BY id LIMIT ?`,
        )
        .bind(tenantId, before, afterId, afterId, limit)
        .all();
      return (res.results ?? []).map((r) => mapLogChunk(r as Record<string, unknown>));
    },
    async delete(tenantId, id) {
      await db
        .prepare("DELETE FROM log_chunks WHERE tenant_id = ? AND id = ?")
        .bind(tenantId, id)
        .run();
    },
    async listPending(before, limit) {
      const res = await db
        .prepare("SELECT * FROM log_chunks WHERE status = 'pending' AND created_at < ? LIMIT ?")
        .bind(before, limit)
        .all();
      return (res.results ?? []).map((r) => mapLogChunk(r as Record<string, unknown>));
    },
  };
}

function mapLogChunk(row: Record<string, unknown>): LogChunk {
  return {
    id: s(row.id),
    tenantId: asTenantId(s(row.tenant_id)),
    streamId: asStreamId(s(row.stream_id)),
    startTime: n(row.start_time),
    endTime: n(row.end_time),
    entryCount: n(row.entry_count),
    compressedSize: n(row.compressed_size),
    checksum: s(row.checksum),
    objectKey: s(row.object_key),
    status: s(row.status) as ChunkStatus,
    createdAt: n(row.created_at),
  };
}

export function d1Dedup(db: D1Database): DedupRepository {
  return {
    async seen(tenantId, eventId) {
      const row = await db
        .prepare("SELECT 1 as x FROM ingestion_dedup WHERE tenant_id = ? AND event_id = ?")
        .bind(tenantId, eventId)
        .first();
      return row !== null;
    },
    async remember(tenantId, eventId, createdAt) {
      await db
        .prepare(
          "INSERT OR IGNORE INTO ingestion_dedup (tenant_id, event_id, created_at) VALUES (?, ?, ?)",
        )
        .bind(tenantId, eventId, createdAt)
        .run();
    },
    async filterUnseen(tenantId, eventIds) {
      if (eventIds.length === 0) return [];
      if (eventIds.length === 1) {
        return (await this.seen(tenantId, eventIds[0]!)) ? [] : [eventIds[0]!];
      }
      const placeholders = eventIds.map(() => "?").join(",");
      const rows = await db
        .prepare(
          `SELECT event_id FROM ingestion_dedup WHERE tenant_id = ? AND event_id IN (${placeholders})`,
        )
        .bind(tenantId, ...eventIds)
        .all<{ event_id: string }>();
      const seen = new Set((rows.results ?? []).map((r) => s(r.event_id)));
      return eventIds.filter((id) => !seen.has(id));
    },
    async rememberMany(tenantId, eventIds, createdAt) {
      if (eventIds.length === 0) return;
      if (eventIds.length === 1) {
        await this.remember(tenantId, eventIds[0]!, createdAt);
        return;
      }
      const stmt = db.prepare(
        "INSERT OR IGNORE INTO ingestion_dedup (tenant_id, event_id, created_at) VALUES (?, ?, ?)",
      );
      await db.batch(eventIds.map((eventId) => stmt.bind(tenantId, eventId, createdAt)));
    },
  };
}

export function d1Series(db: D1Database): MetricSeriesRepository {
  return {
    async findByFingerprint(tenantId, fingerprint) {
      const row = await db
        .prepare("SELECT * FROM metric_series WHERE tenant_id = ? AND fingerprint = ?")
        .bind(tenantId, fingerprint)
        .first();
      return row ? mapSeries(row) : null;
    },
    async listByTenant(tenantId, name, limit) {
      const res = name
        ? await db
            .prepare("SELECT * FROM metric_series WHERE tenant_id = ? AND name = ? LIMIT ?")
            .bind(tenantId, name, limit)
            .all()
        : await db
            .prepare("SELECT * FROM metric_series WHERE tenant_id = ? LIMIT ?")
            .bind(tenantId, limit)
            .all();
      return (res.results ?? []).map((r) => mapSeries(r as Record<string, unknown>));
    },
    async countByTenant(tenantId) {
      const row = await db
        .prepare("SELECT COUNT(*) as c FROM metric_series WHERE tenant_id = ?")
        .bind(tenantId)
        .first<{ c: number }>();
      return n(row?.c ?? 0);
    },
    async save(series) {
      await db
        .prepare(
          `INSERT INTO metric_series (id, tenant_id, name, type, labels_json, fingerprint, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at`,
        )
        .bind(
          series.id,
          series.tenantId,
          series.name,
          series.type,
          JSON.stringify(series.labels.entries),
          series.fingerprint,
          series.createdAt,
          series.lastSeenAt,
        )
        .run();
    },
  };
}

function mapSeries(row: Record<string, unknown>): MetricSeries {
  return {
    id: asSeriesId(s(row.id)),
    tenantId: asTenantId(s(row.tenant_id)),
    name: s(row.name),
    type: s(row.type) as MetricType,
    labels: createLabelSet(JSON.parse(s(row.labels_json)) as Record<string, string>),
    fingerprint: s(row.fingerprint),
    createdAt: n(row.created_at),
    lastSeenAt: n(row.last_seen_at),
  };
}

export function d1MetricChunks(db: D1Database): MetricChunkRepository {
  return {
    async save(chunk) {
      await db
        .prepare(
          `INSERT INTO metric_chunks (id, tenant_id, series_id, start_time, end_time, sample_count, compressed_size, checksum, object_key, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET status=excluded.status`,
        )
        .bind(
          chunk.id,
          chunk.tenantId,
          chunk.seriesId,
          chunk.startTime,
          chunk.endTime,
          chunk.sampleCount,
          chunk.compressedSize,
          chunk.checksum,
          chunk.objectKey,
          chunk.status,
          chunk.createdAt,
        )
        .run();
    },
    async listInRange(tenantId, seriesIds, start, end) {
      if (seriesIds.length === 0) return [];
      const placeholders = seriesIds.map(() => "?").join(",");
      const res = await db
        .prepare(
          `SELECT * FROM metric_chunks WHERE tenant_id = ? AND series_id IN (${placeholders}) AND end_time >= ? AND start_time <= ? LIMIT 200`,
        )
        .bind(tenantId, ...seriesIds, start, end)
        .all();
      return (res.results ?? []).map((r) => mapMetricChunk(r as Record<string, unknown>));
    },
    async listExpired(tenantId, before, afterId, limit) {
      const res = await db
        .prepare(
          `SELECT * FROM metric_chunks WHERE tenant_id = ? AND end_time < ? AND (? IS NULL OR id > ?) ORDER BY id LIMIT ?`,
        )
        .bind(tenantId, before, afterId, afterId, limit)
        .all();
      return (res.results ?? []).map((r) => mapMetricChunk(r as Record<string, unknown>));
    },
    async delete(tenantId, id) {
      await db
        .prepare("DELETE FROM metric_chunks WHERE tenant_id = ? AND id = ?")
        .bind(tenantId, id)
        .run();
    },
  };
}

function mapMetricChunk(row: Record<string, unknown>): MetricChunk {
  return {
    id: s(row.id),
    tenantId: asTenantId(s(row.tenant_id)),
    seriesId: asSeriesId(s(row.series_id)),
    startTime: n(row.start_time),
    endTime: n(row.end_time),
    sampleCount: n(row.sample_count),
    compressedSize: n(row.compressed_size),
    checksum: s(row.checksum),
    objectKey: s(row.object_key),
    status: s(row.status) as ChunkStatus,
    createdAt: n(row.created_at),
  };
}

export function d1Traces(db: D1Database): TraceRepository {
  return {
    async save(trace, spans) {
      await db
        .prepare(
          `INSERT INTO traces (id, tenant_id, root_service, root_operation, start_time, duration_ms, span_count, status, object_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(tenant_id, id) DO UPDATE SET duration_ms=excluded.duration_ms, span_count=excluded.span_count, status=excluded.status, object_key=excluded.object_key`,
        )
        .bind(
          trace.id,
          trace.tenantId,
          trace.rootService,
          trace.rootOperation,
          trace.startTime,
          trace.durationMs,
          trace.spanCount,
          trace.status,
          trace.objectKey,
          trace.createdAt,
        )
        .run();
      for (const span of spans) {
        await db
          .prepare(
            `INSERT INTO spans_index (id, tenant_id, trace_id, span_id, parent_span_id, service, operation, start_time, duration_ms, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(tenant_id, trace_id, span_id) DO NOTHING`,
          )
          .bind(
            crypto.randomUUID(),
            trace.tenantId,
            span.traceId,
            span.spanId,
            span.parentSpanId,
            span.service,
            span.operation,
            span.startTime,
            span.durationMs,
            span.status,
          )
          .run();
      }
    },
    async findById(tenantId, traceId) {
      const row = await db
        .prepare("SELECT * FROM traces WHERE tenant_id = ? AND id = ?")
        .bind(tenantId, traceId)
        .first();
      return row ? mapTrace(row) : null;
    },
    async search(tenantId, filters) {
      const res = await db
        .prepare(
          `SELECT * FROM traces WHERE tenant_id = ? AND start_time >= ? AND start_time <= ?
           AND (? IS NULL OR root_service = ?) AND (? IS NULL OR root_operation = ?)
           AND (? IS NULL OR status = ?) AND (? IS NULL OR duration_ms >= ?)
           ORDER BY start_time DESC LIMIT ?`,
        )
        .bind(
          tenantId,
          filters.start,
          filters.end,
          filters.service ?? null,
          filters.service ?? null,
          filters.operation ?? null,
          filters.operation ?? null,
          filters.status ?? null,
          filters.status ?? null,
          filters.minDurationMs ?? null,
          filters.minDurationMs ?? null,
          filters.limit,
        )
        .all();
      return (res.results ?? []).map((r) => mapTrace(r as Record<string, unknown>));
    },
    async listExpired(tenantId, before, afterId, limit) {
      const res = await db
        .prepare(
          "SELECT * FROM traces WHERE tenant_id = ? AND start_time < ? AND (? IS NULL OR id > ?) ORDER BY id LIMIT ?",
        )
        .bind(tenantId, before, afterId, afterId, limit)
        .all();
      return (res.results ?? []).map((r) => mapTrace(r as Record<string, unknown>));
    },
    async delete(tenantId, id) {
      await db
        .prepare("DELETE FROM spans_index WHERE tenant_id = ? AND trace_id = ?")
        .bind(tenantId, id)
        .run();
      await db
        .prepare("DELETE FROM traces WHERE tenant_id = ? AND id = ?")
        .bind(tenantId, id)
        .run();
    },
  };
}

function mapTrace(row: Record<string, unknown>): Trace {
  return {
    id: asTraceId(s(row.id)),
    tenantId: asTenantId(s(row.tenant_id)),
    rootService: s(row.root_service),
    rootOperation: s(row.root_operation),
    startTime: n(row.start_time),
    durationMs: n(row.duration_ms),
    spanCount: n(row.span_count),
    status: s(row.status) as SpanStatus,
    objectKey: row.object_key === null ? null : s(row.object_key),
    createdAt: n(row.created_at),
  };
}

export function d1Dashboards(db: D1Database): DashboardRepository {
  return {
    async list(tenantId) {
      const res = await db
        .prepare("SELECT * FROM dashboards WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 100")
        .bind(tenantId)
        .all();
      return (res.results ?? []).map((r) => mapDashboard(r as Record<string, unknown>));
    },
    async findById(tenantId, id) {
      const row = await db
        .prepare("SELECT * FROM dashboards WHERE tenant_id = ? AND id = ?")
        .bind(tenantId, id)
        .first();
      return row ? mapDashboard(row) : null;
    },
    async save(dashboard) {
      await db
        .prepare(
          `INSERT INTO dashboards (id, tenant_id, name, description, definition_json, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, definition_json=excluded.definition_json, updated_at=excluded.updated_at`,
        )
        .bind(
          dashboard.id,
          dashboard.tenantId,
          dashboard.name,
          dashboard.description,
          JSON.stringify(dashboard.definition),
          dashboard.createdBy,
          dashboard.createdAt,
          dashboard.updatedAt,
        )
        .run();
    },
    async delete(tenantId, id) {
      await db
        .prepare("DELETE FROM dashboards WHERE tenant_id = ? AND id = ?")
        .bind(tenantId, id)
        .run();
    },
  };
}

function mapDashboard(row: Record<string, unknown>): Dashboard {
  return {
    id: asDashboardId(s(row.id)),
    tenantId: asTenantId(s(row.tenant_id)),
    name: s(row.name),
    description: s(row.description),
    definition: JSON.parse(s(row.definition_json)) as DashboardDefinition,
    createdBy: asUserId(s(row.created_by)),
    createdAt: n(row.created_at),
    updatedAt: n(row.updated_at),
  };
}

export function d1Alerts(db: D1Database): AlertRepository {
  return {
    async list(tenantId) {
      const res = await db
        .prepare("SELECT * FROM alerts WHERE tenant_id = ? LIMIT 100")
        .bind(tenantId)
        .all();
      return (res.results ?? []).map((r) => mapAlert(r as Record<string, unknown>));
    },
    async findById(tenantId, id) {
      const row = await db
        .prepare("SELECT * FROM alerts WHERE tenant_id = ? AND id = ?")
        .bind(tenantId, id)
        .first();
      return row ? mapAlert(row) : null;
    },
    async save(alert) {
      await db
        .prepare(
          `INSERT INTO alerts (id, tenant_id, name, query, kind, threshold, comparator, window_seconds, enabled, created_by, created_at, updated_at, webhook_url, for_seconds)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, query=excluded.query, kind=excluded.kind, threshold=excluded.threshold, comparator=excluded.comparator, window_seconds=excluded.window_seconds, enabled=excluded.enabled, updated_at=excluded.updated_at, webhook_url=excluded.webhook_url, for_seconds=excluded.for_seconds`,
        )
        .bind(
          alert.id,
          alert.tenantId,
          alert.name,
          alert.query,
          alert.kind,
          alert.threshold,
          alert.comparator,
          alert.windowSeconds,
          alert.enabled ? 1 : 0,
          alert.createdBy,
          alert.createdAt,
          alert.updatedAt,
          alert.webhookUrl,
          alert.forSeconds,
        )
        .run();
    },
    async delete(tenantId, id) {
      await db
        .prepare("DELETE FROM alerts WHERE tenant_id = ? AND id = ?")
        .bind(tenantId, id)
        .run();
    },
    async getState(alertId) {
      const row = await db
        .prepare("SELECT * FROM alert_states WHERE alert_id = ?")
        .bind(alertId)
        .first();
      if (!row) return null;
      const rec = row as Record<string, unknown>;
      return {
        alertId: asAlertId(s(rec.alert_id)),
        tenantId: asTenantId(s(rec.tenant_id)),
        status: s(rec.status) as AlertStateStatus,
        lastEvaluatedAt: rec.last_evaluated_at === null ? null : n(rec.last_evaluated_at),
        lastFiredAt: rec.last_fired_at === null ? null : n(rec.last_fired_at),
        lastValue: rec.last_value === null ? null : n(rec.last_value),
      };
    },
    async saveState(state) {
      await db
        .prepare(
          `INSERT INTO alert_states (alert_id, tenant_id, status, last_evaluated_at, last_fired_at, last_value)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(alert_id) DO UPDATE SET status=excluded.status, last_evaluated_at=excluded.last_evaluated_at, last_fired_at=excluded.last_fired_at, last_value=excluded.last_value`,
        )
        .bind(
          state.alertId,
          state.tenantId,
          state.status,
          state.lastEvaluatedAt,
          state.lastFiredAt,
          state.lastValue,
        )
        .run();
    },
    async listEnabled() {
      const res = await db.prepare("SELECT * FROM alerts WHERE enabled = 1 LIMIT 500").all();
      return (res.results ?? []).map((r) => mapAlert(r as Record<string, unknown>));
    },
    async appendEvent(event: AlertEvent) {
      await db
        .prepare(
          `INSERT INTO alert_events (id, tenant_id, alert_id, status, value, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(event.id, event.tenantId, event.alertId, event.status, event.value, event.createdAt)
        .run();
    },
    async listEvents(tenantId, alertId, limit) {
      const res = await db
        .prepare(
          `SELECT * FROM alert_events WHERE tenant_id = ? AND alert_id = ? ORDER BY created_at DESC LIMIT ?`,
        )
        .bind(tenantId, alertId, limit)
        .all();
      return (res.results ?? []).map((r) => {
        const rec = r as Record<string, unknown>;
        return {
          id: s(rec.id),
          tenantId: asTenantId(s(rec.tenant_id)),
          alertId: asAlertId(s(rec.alert_id)),
          status: s(rec.status) as AlertStateStatus,
          value: rec.value === null ? null : n(rec.value),
          createdAt: n(rec.created_at),
        } satisfies AlertEvent;
      });
    },
    async listSilences(tenantId) {
      const res = await db
        .prepare(
          `SELECT * FROM alert_silences WHERE tenant_id = ? ORDER BY starts_at DESC LIMIT 200`,
        )
        .bind(tenantId)
        .all();
      return (res.results ?? []).map((r) => mapSilence(r as Record<string, unknown>));
    },
    async listActiveSilences(tenantId, now) {
      const res = await db
        .prepare(
          `SELECT * FROM alert_silences WHERE tenant_id = ? AND starts_at <= ? AND ends_at > ? LIMIT 200`,
        )
        .bind(tenantId, now, now)
        .all();
      return (res.results ?? []).map((r) => mapSilence(r as Record<string, unknown>));
    },
    async saveSilence(silence) {
      await db
        .prepare(
          `INSERT INTO alert_silences (id, tenant_id, alert_id, starts_at, ends_at, comment, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          silence.id,
          silence.tenantId,
          silence.alertId,
          silence.startsAt,
          silence.endsAt,
          silence.comment,
          silence.createdBy,
          silence.createdAt,
        )
        .run();
    },
    async deleteSilence(tenantId, id) {
      await db
        .prepare(`DELETE FROM alert_silences WHERE tenant_id = ? AND id = ?`)
        .bind(tenantId, id)
        .run();
    },
  };
}

function mapSilence(row: Record<string, unknown>): AlertSilence {
  return {
    id: s(row.id),
    tenantId: asTenantId(s(row.tenant_id)),
    alertId: row.alert_id ? asAlertId(s(row.alert_id)) : null,
    startsAt: n(row.starts_at),
    endsAt: n(row.ends_at),
    comment: s(row.comment ?? ""),
    createdBy: asUserId(s(row.created_by)),
    createdAt: n(row.created_at),
  };
}

function mapAlert(row: Record<string, unknown>): Alert {
  return {
    id: asAlertId(s(row.id)),
    tenantId: asTenantId(s(row.tenant_id)),
    name: s(row.name),
    query: s(row.query),
    kind: s(row.kind) as AlertKind,
    threshold: n(row.threshold),
    comparator: s(row.comparator) as AlertComparator,
    windowSeconds: n(row.window_seconds),
    forSeconds: row.for_seconds === undefined || row.for_seconds === null ? 0 : n(row.for_seconds),
    webhookUrl:
      row.webhook_url === undefined || row.webhook_url === null || row.webhook_url === ""
        ? null
        : s(row.webhook_url),
    enabled: n(row.enabled) === 1,
    createdBy: asUserId(s(row.created_by)),
    createdAt: n(row.created_at),
    updatedAt: n(row.updated_at),
  };
}

export function d1Retention(db: D1Database): RetentionRepository {
  return {
    async find(tenantId) {
      const row = await db
        .prepare("SELECT * FROM retention_policies WHERE tenant_id = ?")
        .bind(tenantId)
        .first();
      return row ? mapRetention(row) : null;
    },
    async save(policy) {
      await db
        .prepare(
          `INSERT INTO retention_policies (tenant_id, logs_days, metrics_days, traces_days, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(tenant_id) DO UPDATE SET logs_days=excluded.logs_days, metrics_days=excluded.metrics_days, traces_days=excluded.traces_days, updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
        )
        .bind(
          policy.tenantId,
          policy.logsDays,
          policy.metricsDays,
          policy.tracesDays,
          policy.updatedAt,
          policy.updatedBy,
        )
        .run();
    },
    async listAll() {
      const res = await db.prepare("SELECT * FROM retention_policies LIMIT 1000").all();
      return (res.results ?? []).map((r) => mapRetention(r as Record<string, unknown>));
    },
  };
}

function mapRetention(row: Record<string, unknown>): RetentionPolicy {
  return {
    tenantId: asTenantId(s(row.tenant_id)),
    logsDays: n(row.logs_days),
    metricsDays: n(row.metrics_days),
    tracesDays: n(row.traces_days),
    updatedAt: n(row.updated_at),
    updatedBy: asUserId(s(row.updated_by)),
  };
}

export function d1Jobs(db: D1Database): DeletionJobRepository {
  return {
    async save(job) {
      await db
        .prepare(
          `INSERT INTO deletion_jobs (id, tenant_id, kind, target, status, cursor, requested_by, error_message, created_at, updated_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET status=excluded.status, cursor=excluded.cursor, error_message=excluded.error_message, updated_at=excluded.updated_at, completed_at=excluded.completed_at`,
        )
        .bind(
          job.id,
          job.tenantId,
          job.kind,
          job.target,
          job.status,
          job.cursor,
          job.requestedBy,
          job.errorMessage,
          job.createdAt,
          job.updatedAt,
          job.completedAt,
        )
        .run();
    },
    async findById(tenantId, id) {
      const row = await db
        .prepare("SELECT * FROM deletion_jobs WHERE tenant_id = ? AND id = ?")
        .bind(tenantId, id)
        .first();
      return row ? mapJob(row) : null;
    },
    async findByIdGlobal(id) {
      const row = await db.prepare("SELECT * FROM deletion_jobs WHERE id = ?").bind(id).first();
      return row ? mapJob(row) : null;
    },
    async list(tenantId) {
      const res = await db
        .prepare(
          "SELECT * FROM deletion_jobs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50",
        )
        .bind(tenantId)
        .all();
      return (res.results ?? []).map((r) => mapJob(r as Record<string, unknown>));
    },
    async listActiveByKind(tenantId, kind, target) {
      const res = await db
        .prepare(
          "SELECT * FROM deletion_jobs WHERE tenant_id = ? AND kind = ? AND target = ? AND status IN ('pending','scheduled','processing')",
        )
        .bind(tenantId, kind, target)
        .all();
      return (res.results ?? []).map((r) => mapJob(r as Record<string, unknown>));
    },
    async listProcessable(limit) {
      const res = await db
        .prepare(
          "SELECT * FROM deletion_jobs WHERE status IN ('pending','scheduled','failed') LIMIT ?",
        )
        .bind(limit)
        .all();
      return (res.results ?? []).map((r) => mapJob(r as Record<string, unknown>));
    },
  };
}

function mapJob(row: Record<string, unknown>): DeletionJob {
  return {
    id: asDeletionJobId(s(row.id)),
    tenantId: asTenantId(s(row.tenant_id)),
    kind: s(row.kind) as DeletionKind,
    target: s(row.target) as DeletionTarget,
    status: s(row.status) as DeletionStatus,
    cursor: row.cursor === null ? null : s(row.cursor),
    requestedBy: row.requested_by === null ? null : asUserId(s(row.requested_by)),
    errorMessage: row.error_message === null ? null : s(row.error_message),
    createdAt: n(row.created_at),
    updatedAt: n(row.updated_at),
    completedAt: row.completed_at === null ? null : n(row.completed_at),
  };
}

export function d1Audit(db: D1Database): AuditRepository {
  return {
    async append(event: AuditEvent) {
      await db
        .prepare(
          `INSERT INTO audit_events (id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata_json, ip_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          event.id,
          event.tenantId,
          event.actorUserId,
          event.action,
          event.resourceType,
          event.resourceId,
          JSON.stringify(event.metadata),
          event.ipHash,
          event.createdAt,
        )
        .run();
    },
    async list(tenantId, limit, afterId) {
      const res = await db
        .prepare(
          "SELECT * FROM audit_events WHERE tenant_id = ? AND (? IS NULL OR id > ?) ORDER BY created_at DESC LIMIT ?",
        )
        .bind(tenantId, afterId, afterId, limit)
        .all();
      return (res.results ?? []).map((r) => {
        const rec = r as Record<string, unknown>;
        return {
          id: s(rec.id),
          tenantId: rec.tenant_id === null ? null : asTenantId(s(rec.tenant_id)),
          actorUserId: rec.actor_user_id === null ? null : asUserId(s(rec.actor_user_id)),
          action: s(rec.action),
          resourceType: rec.resource_type === null ? null : s(rec.resource_type),
          resourceId: rec.resource_id === null ? null : s(rec.resource_id),
          metadata: JSON.parse(s(rec.metadata_json)) as Record<string, string>,
          ipHash: rec.ip_hash === null ? null : s(rec.ip_hash),
          createdAt: n(rec.created_at),
        };
      });
    },
  };
}

export function d1Usage(db: D1Database): UsageRepository {
  return {
    async increment(tenantId, periodStart, delta) {
      await db
        .prepare(
          `INSERT INTO usage_records (id, tenant_id, period_start, ingested_bytes, ingested_events, stored_bytes, query_count, query_duration_ms, api_requests, active_connections_peak)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(tenant_id, period_start) DO UPDATE SET
             ingested_bytes = ingested_bytes + excluded.ingested_bytes,
             ingested_events = ingested_events + excluded.ingested_events,
             stored_bytes = stored_bytes + excluded.stored_bytes,
             query_count = query_count + excluded.query_count,
             query_duration_ms = query_duration_ms + excluded.query_duration_ms,
             api_requests = api_requests + excluded.api_requests,
             active_connections_peak = MAX(active_connections_peak, excluded.active_connections_peak)`,
        )
        .bind(
          `${tenantId}:${periodStart}`,
          tenantId,
          periodStart,
          delta.ingestedBytes ?? 0,
          delta.ingestedEvents ?? 0,
          delta.storedBytes ?? 0,
          delta.queryCount ?? 0,
          delta.queryDurationMs ?? 0,
          delta.apiRequests ?? 0,
          delta.activeConnectionsPeak ?? 0,
        )
        .run();
    },
    async get(tenantId, periodStart) {
      const row = await db
        .prepare("SELECT * FROM usage_records WHERE tenant_id = ? AND period_start = ?")
        .bind(tenantId, periodStart)
        .first();
      return row ? mapUsage(row) : null;
    },
    async list(tenantId, from, to) {
      const res = await db
        .prepare(
          "SELECT * FROM usage_records WHERE tenant_id = ? AND period_start >= ? AND period_start <= ? LIMIT 168",
        )
        .bind(tenantId, from, to)
        .all();
      return (res.results ?? []).map((r) => mapUsage(r as Record<string, unknown>));
    },
  };
}

function mapUsage(row: Record<string, unknown>): UsageRecord {
  return {
    id: s(row.id),
    tenantId: asTenantId(s(row.tenant_id)),
    periodStart: n(row.period_start),
    ingestedBytes: n(row.ingested_bytes),
    ingestedEvents: n(row.ingested_events),
    storedBytes: n(row.stored_bytes),
    queryCount: n(row.query_count),
    queryDurationMs: n(row.query_duration_ms),
    apiRequests: n(row.api_requests),
    activeConnectionsPeak: n(row.active_connections_peak),
  };
}

export function d1Apm(db: D1Database): ApmRepository {
  return {
    async increment(stats) {
      const id = `${stats.tenantId}:${stats.service}:${stats.operation}:${stats.periodStart}`;
      const existing = await db
        .prepare(
          `SELECT duration_hist_json FROM apm_endpoint_stats
           WHERE tenant_id = ? AND service = ? AND operation = ? AND period_start = ?`,
        )
        .bind(stats.tenantId, stats.service, stats.operation, stats.periodStart)
        .first();
      const prevHist = parseHistJson(
        existing ? s((existing as Record<string, unknown>).duration_hist_json) : "{}",
      );
      const nextHist = mergeLatencyHist(prevHist, stats.durationHist ?? {});
      await db
        .prepare(
          `INSERT INTO apm_endpoint_stats (id, tenant_id, service, operation, period_start, request_count, error_count, duration_sum_ms, duration_max_ms, duration_hist_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(tenant_id, service, operation, period_start) DO UPDATE SET
             request_count = request_count + excluded.request_count,
             error_count = error_count + excluded.error_count,
             duration_sum_ms = duration_sum_ms + excluded.duration_sum_ms,
             duration_max_ms = MAX(duration_max_ms, excluded.duration_max_ms),
             duration_hist_json = excluded.duration_hist_json`,
        )
        .bind(
          id,
          stats.tenantId,
          stats.service,
          stats.operation,
          stats.periodStart,
          stats.requestCount,
          stats.errorCount,
          stats.durationSumMs,
          stats.durationMaxMs,
          JSON.stringify(nextHist),
        )
        .run();
    },
    async query(tenantId, from, to, service) {
      const res = await db
        .prepare(
          `SELECT tenant_id, service, operation, period_start,
                  SUM(request_count) as request_count, SUM(error_count) as error_count,
                  SUM(duration_sum_ms) as duration_sum_ms, MAX(duration_max_ms) as duration_max_ms,
                  GROUP_CONCAT(duration_hist_json, '\n') as duration_hist_json
           FROM apm_endpoint_stats
           WHERE tenant_id = ? AND period_start >= ? AND period_start <= ? AND (? IS NULL OR service = ?)
           GROUP BY tenant_id, service, operation, period_start LIMIT 200`,
        )
        .bind(tenantId, from, to, service, service)
        .all();
      return (res.results ?? []).map((r) => {
        const rec = r as Record<string, unknown>;
        const histParts = s(rec.duration_hist_json || "{}").split("\n");
        let hist = parseHistJson("{}");
        for (const part of histParts) hist = mergeLatencyHist(hist, parseHistJson(part));
        return {
          tenantId: asTenantId(s(rec.tenant_id)),
          service: s(rec.service),
          operation: s(rec.operation),
          periodStart: n(rec.period_start),
          requestCount: n(rec.request_count),
          errorCount: n(rec.error_count),
          durationSumMs: n(rec.duration_sum_ms),
          durationMaxMs: n(rec.duration_max_ms),
          durationHist: hist,
        } satisfies EndpointStats;
      });
    },
    async incrementEdge(edge) {
      await db
        .prepare(
          `INSERT INTO apm_service_edges (id, tenant_id, from_service, to_service, period_start, call_count, error_count)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(tenant_id, from_service, to_service, period_start) DO UPDATE SET
             call_count = call_count + excluded.call_count,
             error_count = error_count + excluded.error_count`,
        )
        .bind(
          `${edge.tenantId}:${edge.fromService}:${edge.toService}:${edge.periodStart}`,
          edge.tenantId,
          edge.fromService,
          edge.toService,
          edge.periodStart,
          edge.callCount,
          edge.errorCount,
        )
        .run();
    },
    async queryEdges(tenantId, from, to) {
      const res = await db
        .prepare(
          `SELECT tenant_id, from_service, to_service, period_start,
                  SUM(call_count) as call_count, SUM(error_count) as error_count
           FROM apm_service_edges
           WHERE tenant_id = ? AND period_start >= ? AND period_start <= ?
           GROUP BY tenant_id, from_service, to_service, period_start LIMIT 500`,
        )
        .bind(tenantId, from, to)
        .all();
      return (res.results ?? []).map((r) => {
        const rec = r as Record<string, unknown>;
        return {
          tenantId: asTenantId(s(rec.tenant_id)),
          fromService: s(rec.from_service),
          toService: s(rec.to_service),
          periodStart: n(rec.period_start),
          callCount: n(rec.call_count),
          errorCount: n(rec.error_count),
        } satisfies ServiceEdge;
      });
    },
  };
}
