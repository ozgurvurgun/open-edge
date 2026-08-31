import type { ApiKey } from "../../domain/identity/api-key.js";
import type { Session } from "../../domain/identity/session.js";
import type { User } from "../../domain/identity/user.js";
import type { Membership, Tenant } from "../../domain/tenant/tenant.js";
import type { LogChunk, LogStream } from "../../domain/logs/log-stream.js";
import type { MetricChunk, MetricSeries } from "../../domain/metrics/metric.js";
import type { Span, Trace } from "../../domain/tracing/trace.js";
import type { Dashboard } from "../../domain/dashboard/dashboard.js";
import type { Alert, AlertEvent, AlertState } from "../../domain/alerting/alert.js";
import type { AlertSilence } from "../../domain/alerting/silence.js";
import type { RetentionPolicy } from "../../domain/retention/policy.js";
import type { DeletionJob } from "../../domain/deletion/job.js";
import type { AuditEvent } from "../../domain/audit/audit-event.js";
import type { UsageDelta, UsageRecord } from "../../domain/usage/usage-record.js";
import type { EndpointStats } from "../../domain/apm/stats.js";
import type { ServiceEdge } from "../../domain/apm/service-edge.js";
import { mergeLatencyHist, emptyLatencyHist } from "../../domain/apm/histogram.js";
import type {
  ApiKeyRepository,
  ApmRepository,
  AuditRepository,
  CacheStore,
  DedupRepository,
  DeletionJobRepository,
  LogChunkRepository,
  LogStreamRepository,
  LoginAttemptRepository,
  MembershipRepository,
  MetricChunkRepository,
  MetricSeriesRepository,
  ObjectStore,
  RetentionRepository,
  SessionRepository,
  TenantRepository,
  TraceRepository,
  UsageRepository,
  UserRepository,
  QueuePort,
  IngestQueueMessage,
  DeletionQueueMessage,
  RealtimePort,
  DashboardRepository,
  AlertRepository,
} from "../../application/ports.js";
import type {
  ApiKeyId,
  DeletionJobId,
  EventId,
  SessionId,
  StreamId,
  TenantId,
  TraceId,
} from "../../shared/ids.js";

export class MemoryWorld {
  public readonly users = new Map<string, User>();
  public readonly tenants = new Map<string, Tenant>();
  public readonly memberships: Membership[] = [];
  public readonly sessions = new Map<string, Session>();
  public readonly apiKeys = new Map<string, ApiKey>();
  public readonly attempts: Array<{
    emailHash: string;
    ipHash: string;
    succeeded: boolean;
    createdAt: number;
  }> = [];
  public readonly streams = new Map<string, LogStream>();
  public readonly logChunks = new Map<string, LogChunk>();
  public readonly series = new Map<string, MetricSeries>();
  public readonly metricChunks = new Map<string, MetricChunk>();
  public readonly traces = new Map<string, Trace>();
  public readonly spans = new Map<string, Span[]>();
  public readonly dashboards = new Map<string, Dashboard>();
  public readonly alerts = new Map<string, Alert>();
  public readonly alertStates = new Map<string, AlertState>();
  public readonly alertEvents: AlertEvent[] = [];
  public readonly silences: AlertSilence[] = [];
  public readonly retention = new Map<string, RetentionPolicy>();
  public readonly jobs = new Map<string, DeletionJob>();
  public readonly audit: AuditEvent[] = [];
  public readonly usage = new Map<string, UsageRecord>();
  public readonly apm = new Map<string, EndpointStats>();
  public readonly apmEdges = new Map<string, ServiceEdge>();
  public readonly objects = new Map<string, Uint8Array>();
  public readonly kv = new Map<string, { value: string; expiresAt: number | null }>();
  public readonly dedup = new Set<string>();
  public readonly ingestQueue: IngestQueueMessage[] = [];
  public readonly deletionQueue: DeletionQueueMessage[] = [];
  public readonly realtime: Array<{
    tenantId: string;
    streamId: string;
    line: string;
    timestamp: number;
  }> = [];
}

export function memoryUserRepo(w: MemoryWorld): UserRepository {
  return {
    async findById(id) {
      return w.users.get(id) ?? null;
    },
    async findByEmail(email) {
      return [...w.users.values()].find((u) => u.email === email) ?? null;
    },
    async save(user) {
      w.users.set(user.id, user);
    },
  };
}

export function memoryTenantRepo(w: MemoryWorld): TenantRepository {
  return {
    async findById(id) {
      return w.tenants.get(id) ?? null;
    },
    async findBySlug(slug) {
      return [...w.tenants.values()].find((t) => t.slug === slug) ?? null;
    },
    async save(tenant) {
      w.tenants.set(tenant.id, tenant);
    },
  };
}

export function memoryMembershipRepo(w: MemoryWorld): MembershipRepository {
  return {
    async find(tenantId, userId) {
      return w.memberships.find((m) => m.tenantId === tenantId && m.userId === userId) ?? null;
    },
    async listByTenant(tenantId) {
      return w.memberships.filter((m) => m.tenantId === tenantId);
    },
    async listByUser(userId) {
      return w.memberships.filter((m) => m.userId === userId);
    },
    async save(membership) {
      const i = w.memberships.findIndex(
        (m) => m.tenantId === membership.tenantId && m.userId === membership.userId,
      );
      if (i >= 0) {
        w.memberships[i] = membership;
      } else {
        w.memberships.push(membership);
      }
    },
    async delete(tenantId, userId) {
      const i = w.memberships.findIndex((m) => m.tenantId === tenantId && m.userId === userId);
      if (i >= 0) {
        w.memberships.splice(i, 1);
      }
    },
  };
}

export function memorySessionRepo(w: MemoryWorld): SessionRepository {
  return {
    async findById(id: SessionId) {
      return w.sessions.get(id) ?? null;
    },
    async findByTokenHash(tokenHash) {
      return [...w.sessions.values()].find((s) => s.tokenHash === tokenHash) ?? null;
    },
    async listByUser(userId) {
      const now = Date.now();
      return [...w.sessions.values()].filter(
        (s) => s.userId === userId && s.revokedAt === null && s.expiresAt > now,
      );
    },
    async save(session) {
      w.sessions.set(session.id, session);
    },
    async revokeAllForUser(userId, now) {
      let n = 0;
      for (const s of w.sessions.values()) {
        if (s.userId === userId && s.revokedAt === null) {
          w.sessions.set(s.id, { ...s, revokedAt: now });
          n += 1;
        }
      }
      return n;
    },
    async revokeAllForTenant(tenantId, now) {
      let n = 0;
      for (const s of w.sessions.values()) {
        if (s.tenantId === tenantId && s.revokedAt === null) {
          w.sessions.set(s.id, { ...s, revokedAt: now });
          n += 1;
        }
      }
      return n;
    },
  };
}

export function memoryApiKeyRepo(w: MemoryWorld): ApiKeyRepository {
  return {
    async findById(tenantId, id: ApiKeyId) {
      const key = w.apiKeys.get(id);
      return key && key.tenantId === tenantId ? key : null;
    },
    async findByHash(keyHash) {
      return [...w.apiKeys.values()].find((k) => k.keyHash === keyHash) ?? null;
    },
    async listByTenant(tenantId) {
      return [...w.apiKeys.values()].filter((k) => k.tenantId === tenantId && k.revokedAt === null);
    },
    async save(key) {
      w.apiKeys.set(key.id, key);
    },
    async revokeAllForTenant(tenantId, now) {
      let n = 0;
      for (const k of w.apiKeys.values()) {
        if (k.tenantId === tenantId && k.revokedAt === null) {
          w.apiKeys.set(k.id, { ...k, revokedAt: now });
          n += 1;
        }
      }
      return n;
    },
  };
}

export function memoryAttemptsRepo(w: MemoryWorld): LoginAttemptRepository {
  return {
    async record(emailHash, ipHash, succeeded, createdAt) {
      w.attempts.push({ emailHash, ipHash, succeeded, createdAt });
    },
    async countRecentFailures(emailHash, ipHash, since) {
      return w.attempts.filter(
        (a) =>
          !a.succeeded &&
          a.createdAt >= since &&
          (a.emailHash === emailHash || a.ipHash === ipHash),
      ).length;
    },
  };
}

export function memoryStreamRepo(w: MemoryWorld): LogStreamRepository {
  return {
    async findByFingerprint(tenantId, fingerprint) {
      return (
        [...w.streams.values()].find(
          (s) => s.tenantId === tenantId && s.fingerprint === fingerprint,
        ) ?? null
      );
    },
    async findById(tenantId, id: StreamId) {
      const s = w.streams.get(id);
      return s && s.tenantId === tenantId ? s : null;
    },
    async listByTenant(tenantId, limit) {
      return [...w.streams.values()].filter((s) => s.tenantId === tenantId).slice(0, limit);
    },
    async countByTenant(tenantId) {
      return [...w.streams.values()].filter((s) => s.tenantId === tenantId).length;
    },
    async save(stream) {
      w.streams.set(stream.id, stream);
    },
  };
}

export function memoryLogChunkRepo(w: MemoryWorld): LogChunkRepository {
  return {
    async save(chunk) {
      w.logChunks.set(chunk.id, chunk);
    },
    async listInRange(tenantId, streamIds, start, end) {
      return [...w.logChunks.values()].filter(
        (c) =>
          c.tenantId === tenantId &&
          streamIds.includes(c.streamId) &&
          c.endTime >= start &&
          c.startTime <= end,
      );
    },
    async listExpired(tenantId, before, afterId, limit) {
      return [...w.logChunks.values()]
        .filter(
          (c) =>
            c.tenantId === tenantId && c.endTime < before && (afterId === null || c.id > afterId),
        )
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, limit);
    },
    async delete(tenantId, id) {
      const c = w.logChunks.get(id);
      if (c && c.tenantId === tenantId) {
        w.logChunks.delete(id);
      }
    },
    async listPending(before, limit) {
      return [...w.logChunks.values()]
        .filter((c) => c.status === "pending" && c.createdAt < before)
        .slice(0, limit);
    },
  };
}

export function memorySeriesRepo(w: MemoryWorld): MetricSeriesRepository {
  return {
    async findByFingerprint(tenantId, fingerprint) {
      return (
        [...w.series.values()].find(
          (s) => s.tenantId === tenantId && s.fingerprint === fingerprint,
        ) ?? null
      );
    },
    async listByTenant(tenantId, name, limit) {
      return [...w.series.values()]
        .filter((s) => s.tenantId === tenantId && (name === null || s.name === name))
        .slice(0, limit);
    },
    async countByTenant(tenantId) {
      return [...w.series.values()].filter((s) => s.tenantId === tenantId).length;
    },
    async save(series) {
      w.series.set(series.id, series);
    },
  };
}

export function memoryMetricChunkRepo(w: MemoryWorld): MetricChunkRepository {
  return {
    async save(chunk) {
      w.metricChunks.set(chunk.id, chunk);
    },
    async listInRange(tenantId, seriesIds, start, end) {
      return [...w.metricChunks.values()].filter(
        (c) =>
          c.tenantId === tenantId &&
          seriesIds.includes(c.seriesId) &&
          c.endTime >= start &&
          c.startTime <= end,
      );
    },
    async listExpired(tenantId, before, afterId, limit) {
      return [...w.metricChunks.values()]
        .filter(
          (c) =>
            c.tenantId === tenantId && c.endTime < before && (afterId === null || c.id > afterId),
        )
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, limit);
    },
    async delete(tenantId, id) {
      const c = w.metricChunks.get(id);
      if (c && c.tenantId === tenantId) {
        w.metricChunks.delete(id);
      }
    },
  };
}

export function memoryTraceRepo(w: MemoryWorld): TraceRepository {
  return {
    async save(trace, spans) {
      w.traces.set(`${trace.tenantId}:${trace.id}`, trace);
      w.spans.set(`${trace.tenantId}:${trace.id}`, [...spans]);
    },
    async findById(tenantId: TenantId, traceId: TraceId) {
      return w.traces.get(`${tenantId}:${traceId}`) ?? null;
    },
    async search(tenantId, filters) {
      return [...w.traces.values()]
        .filter((t) => {
          if (t.tenantId !== tenantId) return false;
          if (t.startTime < filters.start || t.startTime > filters.end) return false;
          if (filters.service && t.rootService !== filters.service) return false;
          if (filters.operation && t.rootOperation !== filters.operation) return false;
          if (filters.status && t.status !== filters.status) return false;
          if (filters.minDurationMs && t.durationMs < filters.minDurationMs) return false;
          return true;
        })
        .slice(0, filters.limit);
    },
    async listExpired(tenantId, before, afterId, limit) {
      return [...w.traces.values()]
        .filter(
          (t) =>
            t.tenantId === tenantId && t.startTime < before && (afterId === null || t.id > afterId),
        )
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, limit);
    },
    async delete(tenantId, id) {
      w.traces.delete(`${tenantId}:${id}`);
      w.spans.delete(`${tenantId}:${id}`);
    },
  };
}

export function memoryDashboardRepo(w: MemoryWorld): DashboardRepository {
  return {
    async list(tenantId) {
      return [...w.dashboards.values()].filter((d) => d.tenantId === tenantId);
    },
    async findById(tenantId, id) {
      const d = w.dashboards.get(id);
      return d && d.tenantId === tenantId ? d : null;
    },
    async save(dashboard) {
      w.dashboards.set(dashboard.id, dashboard);
    },
    async delete(tenantId, id) {
      const d = w.dashboards.get(id);
      if (d && d.tenantId === tenantId) {
        w.dashboards.delete(id);
      }
    },
  };
}

export function memoryAlertRepo(w: MemoryWorld): AlertRepository {
  return {
    async list(tenantId) {
      return [...w.alerts.values()].filter((a) => a.tenantId === tenantId);
    },
    async findById(tenantId, id) {
      const a = w.alerts.get(id);
      return a && a.tenantId === tenantId ? a : null;
    },
    async save(alert) {
      w.alerts.set(alert.id, alert);
    },
    async delete(tenantId, id) {
      const a = w.alerts.get(id);
      if (a && a.tenantId === tenantId) {
        w.alerts.delete(id);
      }
    },
    async getState(alertId) {
      return w.alertStates.get(alertId) ?? null;
    },
    async saveState(state) {
      w.alertStates.set(state.alertId, state);
    },
    async listEnabled() {
      return [...w.alerts.values()].filter((a) => a.enabled);
    },
    async appendEvent(event) {
      w.alertEvents.push(event);
    },
    async listEvents(tenantId, alertId, limit) {
      return w.alertEvents
        .filter((e) => e.tenantId === tenantId && e.alertId === alertId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
    },
    async listSilences(tenantId) {
      return w.silences.filter((s) => s.tenantId === tenantId);
    },
    async listActiveSilences(tenantId, now) {
      return w.silences.filter(
        (s) => s.tenantId === tenantId && s.startsAt <= now && s.endsAt > now,
      );
    },
    async saveSilence(silence) {
      w.silences.push(silence);
    },
    async deleteSilence(tenantId, id) {
      const i = w.silences.findIndex((s) => s.tenantId === tenantId && s.id === id);
      if (i >= 0) w.silences.splice(i, 1);
    },
  };
}

export function memoryRetentionRepo(w: MemoryWorld): RetentionRepository {
  return {
    async find(tenantId) {
      return w.retention.get(tenantId) ?? null;
    },
    async save(policy) {
      w.retention.set(policy.tenantId, policy);
    },
    async listAll() {
      return [...w.retention.values()];
    },
  };
}

export function memoryJobRepo(w: MemoryWorld): DeletionJobRepository {
  return {
    async save(job) {
      w.jobs.set(job.id, job);
    },
    async findById(tenantId, id: DeletionJobId) {
      const j = w.jobs.get(id);
      return j && j.tenantId === tenantId ? j : null;
    },
    async findByIdGlobal(id) {
      return w.jobs.get(id) ?? null;
    },
    async list(tenantId) {
      return [...w.jobs.values()].filter((j) => j.tenantId === tenantId);
    },
    async listActiveByKind(tenantId, kind, target) {
      return [...w.jobs.values()].filter(
        (j) =>
          j.tenantId === tenantId &&
          j.kind === kind &&
          j.target === target &&
          (j.status === "pending" || j.status === "scheduled" || j.status === "processing"),
      );
    },
    async listProcessable(limit) {
      return [...w.jobs.values()]
        .filter((j) => j.status === "pending" || j.status === "scheduled" || j.status === "failed")
        .slice(0, limit);
    },
  };
}

export function memoryAuditRepo(w: MemoryWorld): AuditRepository {
  return {
    async append(event) {
      w.audit.push(event);
    },
    async list(tenantId, limit, afterId) {
      return w.audit
        .filter((e) => e.tenantId === tenantId && (afterId === null || e.id > afterId))
        .slice(0, limit);
    },
  };
}

export function memoryUsageRepo(w: MemoryWorld): UsageRepository {
  return {
    async increment(tenantId, periodStart, delta: UsageDelta) {
      const key = `${tenantId}:${periodStart}`;
      const cur = w.usage.get(key) ?? {
        id: key,
        tenantId,
        periodStart,
        ingestedBytes: 0,
        ingestedEvents: 0,
        storedBytes: 0,
        queryCount: 0,
        queryDurationMs: 0,
        apiRequests: 0,
        activeConnectionsPeak: 0,
      };
      w.usage.set(key, {
        ...cur,
        ingestedBytes: cur.ingestedBytes + (delta.ingestedBytes ?? 0),
        ingestedEvents: cur.ingestedEvents + (delta.ingestedEvents ?? 0),
        storedBytes: cur.storedBytes + (delta.storedBytes ?? 0),
        queryCount: cur.queryCount + (delta.queryCount ?? 0),
        queryDurationMs: cur.queryDurationMs + (delta.queryDurationMs ?? 0),
        apiRequests: cur.apiRequests + (delta.apiRequests ?? 0),
        activeConnectionsPeak: Math.max(
          cur.activeConnectionsPeak,
          delta.activeConnectionsPeak ?? 0,
        ),
      });
    },
    async get(tenantId, periodStart) {
      return w.usage.get(`${tenantId}:${periodStart}`) ?? null;
    },
    async list(tenantId, from, to) {
      return [...w.usage.values()].filter(
        (u) => u.tenantId === tenantId && u.periodStart >= from && u.periodStart <= to,
      );
    },
  };
}

export function memoryApmRepo(w: MemoryWorld): ApmRepository {
  return {
    async increment(stats) {
      const key = `${stats.tenantId}:${stats.service}:${stats.operation}:${stats.periodStart}`;
      const cur = w.apm.get(key);
      if (!cur) {
        w.apm.set(key, {
          ...stats,
          durationHist: stats.durationHist ?? emptyLatencyHist(),
        });
        return;
      }
      w.apm.set(key, {
        ...cur,
        requestCount: cur.requestCount + stats.requestCount,
        errorCount: cur.errorCount + stats.errorCount,
        durationSumMs: cur.durationSumMs + stats.durationSumMs,
        durationMaxMs: Math.max(cur.durationMaxMs, stats.durationMaxMs),
        durationHist: mergeLatencyHist(
          cur.durationHist ?? emptyLatencyHist(),
          stats.durationHist ?? emptyLatencyHist(),
        ),
      });
    },
    async query(tenantId, from, to, service) {
      return [...w.apm.values()].filter(
        (s) =>
          s.tenantId === tenantId &&
          s.periodStart >= from &&
          s.periodStart <= to &&
          (service === null || s.service === service),
      );
    },
    async incrementEdge(edge) {
      const key = `${edge.tenantId}:${edge.fromService}:${edge.toService}:${edge.periodStart}`;
      const cur = w.apmEdges.get(key);
      if (!cur) {
        w.apmEdges.set(key, edge);
        return;
      }
      w.apmEdges.set(key, {
        ...cur,
        callCount: cur.callCount + edge.callCount,
        errorCount: cur.errorCount + edge.errorCount,
      });
    },
    async queryEdges(tenantId, from, to) {
      return [...w.apmEdges.values()].filter(
        (e) => e.tenantId === tenantId && e.periodStart >= from && e.periodStart <= to,
      );
    },
  };
}

export function memoryObjects(w: MemoryWorld): ObjectStore {
  return {
    async put(key, body) {
      w.objects.set(key, body);
    },
    async get(key) {
      return w.objects.get(key) ?? null;
    },
    async delete(key) {
      w.objects.delete(key);
    },
  };
}

export function memoryCache(w: MemoryWorld, now: () => number): CacheStore {
  return {
    async get(key) {
      const hit = w.kv.get(key);
      if (!hit) return null;
      if (hit.expiresAt !== null && hit.expiresAt <= now()) {
        w.kv.delete(key);
        return null;
      }
      return hit.value;
    },
    async put(key, value, ttlSeconds) {
      w.kv.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
    },
    async delete(key) {
      w.kv.delete(key);
    },
  };
}

export function memoryDedup(w: MemoryWorld): DedupRepository {
  return {
    async seen(tenantId: TenantId, eventId: EventId) {
      return w.dedup.has(`${tenantId}:${eventId}`);
    },
    async remember(tenantId, eventId) {
      w.dedup.add(`${tenantId}:${eventId}`);
    },
    async filterUnseen(tenantId, eventIds) {
      return eventIds.filter((id) => !w.dedup.has(`${tenantId}:${id}`));
    },
    async rememberMany(tenantId, eventIds) {
      for (const eventId of eventIds) {
        w.dedup.add(`${tenantId}:${eventId}`);
      }
    },
  };
}

export function memoryQueue(w: MemoryWorld): QueuePort {
  return {
    async publishIngest(message) {
      w.ingestQueue.push(message);
    },
    async publishDeletion(message) {
      w.deletionQueue.push(message);
    },
  };
}

export function memoryRealtime(w: MemoryWorld): RealtimePort {
  return {
    async publish(tenantId, entry) {
      w.realtime.push({ tenantId, ...entry });
    },
  };
}
