import type { ApiKey } from "../domain/identity/api-key.js";
import type { Session } from "../domain/identity/session.js";
import type { User } from "../domain/identity/user.js";
import type { Role } from "../domain/identity/permissions.js";
import type { Membership, Tenant } from "../domain/tenant/tenant.js";
import type { LogChunk, LogStream } from "../domain/logs/log-stream.js";
import type { MetricChunk, MetricSeries } from "../domain/metrics/metric.js";
import type { Span, Trace } from "../domain/tracing/trace.js";
import type { Dashboard } from "../domain/dashboard/dashboard.js";
import type { Alert, AlertEvent, AlertState } from "../domain/alerting/alert.js";
import type { AlertSilence } from "../domain/alerting/silence.js";
import type { RetentionPolicy } from "../domain/retention/policy.js";
import type { DeletionJob } from "../domain/deletion/job.js";
import type { AuditEvent } from "../domain/audit/audit-event.js";
import type { ServiceEdge } from "../domain/apm/service-edge.js";
import type { UsageDelta, UsageRecord } from "../domain/usage/usage-record.js";
import type { EndpointStats } from "../domain/apm/stats.js";
import type {
  ApiKeyId,
  DeletionJobId,
  EventId,
  SessionId,
  StreamId,
  TenantId,
  TraceId,
  UserId,
} from "../shared/ids.js";
import type { TelemetryKind } from "../domain/ingestion/event.js";

export interface Clock {
  now(): number;
}

export interface IdGenerator {
  id(): string;
}

export interface PasswordHasher {
  hash(password: string): Promise<{ hash: string; salt: string }>;
  verify(password: string, hash: string, salt: string): Promise<boolean>;
}

export interface TokenHasher {
  hash(token: string): Promise<string>;
  randomToken(): string;
}

export interface UserRepository {
  findById(id: UserId): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  save(user: User): Promise<void>;
}

export interface SessionRepository {
  findById(id: SessionId): Promise<Session | null>;
  findByTokenHash(tokenHash: string): Promise<Session | null>;
  listByUser(userId: UserId): Promise<Session[]>;
  save(session: Session): Promise<void>;
  revokeAllForUser(userId: UserId, now: number): Promise<number>;
  revokeAllForTenant(tenantId: TenantId, now: number): Promise<number>;
}

export interface ApiKeyRepository {
  findById(tenantId: TenantId, id: ApiKeyId): Promise<ApiKey | null>;
  findByHash(keyHash: string): Promise<ApiKey | null>;
  listByTenant(tenantId: TenantId): Promise<ApiKey[]>;
  save(key: ApiKey): Promise<void>;
  revokeAllForTenant(tenantId: TenantId, now: number): Promise<number>;
}

export interface TenantRepository {
  findById(id: TenantId): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
  save(tenant: Tenant): Promise<void>;
}

export interface MembershipRepository {
  find(tenantId: TenantId, userId: UserId): Promise<Membership | null>;
  listByTenant(tenantId: TenantId): Promise<Membership[]>;
  listByUser(userId: UserId): Promise<Membership[]>;
  save(membership: Membership): Promise<void>;
  delete(tenantId: TenantId, userId: UserId): Promise<void>;
}

export interface LoginAttemptRepository {
  record(emailHash: string, ipHash: string, succeeded: boolean, createdAt: number): Promise<void>;
  countRecentFailures(emailHash: string, ipHash: string, since: number): Promise<number>;
}

export interface LogStreamRepository {
  findByFingerprint(tenantId: TenantId, fingerprint: string): Promise<LogStream | null>;
  findById(tenantId: TenantId, id: StreamId): Promise<LogStream | null>;
  listByTenant(tenantId: TenantId, limit: number): Promise<LogStream[]>;
  countByTenant(tenantId: TenantId): Promise<number>;
  save(stream: LogStream): Promise<void>;
}

export interface LogChunkRepository {
  save(chunk: LogChunk): Promise<void>;
  listInRange(
    tenantId: TenantId,
    streamIds: readonly string[],
    start: number,
    end: number,
  ): Promise<LogChunk[]>;
  listExpired(
    tenantId: TenantId,
    before: number,
    afterId: string | null,
    limit: number,
  ): Promise<LogChunk[]>;
  delete(tenantId: TenantId, id: string): Promise<void>;
  listPending(before: number, limit: number): Promise<LogChunk[]>;
}

export interface DedupRepository {
  seen(tenantId: TenantId, eventId: EventId): Promise<boolean>;
  remember(tenantId: TenantId, eventId: EventId, createdAt: number): Promise<void>;
  /** Event ids not yet recorded for this tenant (input order preserved). */
  filterUnseen(tenantId: TenantId, eventIds: EventId[]): Promise<EventId[]>;
  rememberMany(tenantId: TenantId, eventIds: EventId[], createdAt: number): Promise<void>;
}

export interface MetricSeriesRepository {
  findByFingerprint(tenantId: TenantId, fingerprint: string): Promise<MetricSeries | null>;
  listByTenant(tenantId: TenantId, name: string | null, limit: number): Promise<MetricSeries[]>;
  countByTenant(tenantId: TenantId): Promise<number>;
  save(series: MetricSeries): Promise<void>;
}

export interface MetricChunkRepository {
  save(chunk: MetricChunk): Promise<void>;
  listInRange(
    tenantId: TenantId,
    seriesIds: readonly string[],
    start: number,
    end: number,
  ): Promise<MetricChunk[]>;
  listExpired(
    tenantId: TenantId,
    before: number,
    afterId: string | null,
    limit: number,
  ): Promise<MetricChunk[]>;
  delete(tenantId: TenantId, id: string): Promise<void>;
}

export interface TraceRepository {
  save(trace: Trace, spans: readonly Span[]): Promise<void>;
  findById(tenantId: TenantId, traceId: TraceId): Promise<Trace | null>;
  search(
    tenantId: TenantId,
    filters: {
      start: number;
      end: number;
      service?: string;
      operation?: string;
      status?: "ok" | "error";
      minDurationMs?: number;
      limit: number;
    },
  ): Promise<Trace[]>;
  listExpired(
    tenantId: TenantId,
    before: number,
    afterId: string | null,
    limit: number,
  ): Promise<Trace[]>;
  delete(tenantId: TenantId, id: string): Promise<void>;
}

export interface ObjectStore {
  put(key: string, body: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

export interface CacheStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface QueuePort {
  publishIngest(message: IngestQueueMessage): Promise<void>;
  publishDeletion(message: DeletionQueueMessage): Promise<void>;
}

export interface IngestQueueMessage {
  readonly tenantId: TenantId;
  readonly kind: TelemetryKind;
  readonly eventId: EventId;
  readonly receivedAt: number;
  readonly payload: unknown;
}

export interface DeletionQueueMessage {
  readonly jobId: DeletionJobId;
  readonly tenantId: TenantId;
}

export interface DashboardRepository {
  list(tenantId: TenantId): Promise<Dashboard[]>;
  findById(tenantId: TenantId, id: string): Promise<Dashboard | null>;
  save(dashboard: Dashboard): Promise<void>;
  delete(tenantId: TenantId, id: string): Promise<void>;
}

export interface AlertRepository {
  list(tenantId: TenantId): Promise<Alert[]>;
  findById(tenantId: TenantId, id: string): Promise<Alert | null>;
  save(alert: Alert): Promise<void>;
  delete(tenantId: TenantId, id: string): Promise<void>;
  getState(alertId: string): Promise<AlertState | null>;
  saveState(state: AlertState): Promise<void>;
  listEnabled(): Promise<Alert[]>;
  appendEvent(event: AlertEvent): Promise<void>;
  listEvents(tenantId: TenantId, alertId: string, limit: number): Promise<AlertEvent[]>;
  listSilences(tenantId: TenantId): Promise<AlertSilence[]>;
  listActiveSilences(tenantId: TenantId, now: number): Promise<AlertSilence[]>;
  saveSilence(silence: AlertSilence): Promise<void>;
  deleteSilence(tenantId: TenantId, id: string): Promise<void>;
}

export interface RetentionRepository {
  find(tenantId: TenantId): Promise<RetentionPolicy | null>;
  save(policy: RetentionPolicy): Promise<void>;
  listAll(): Promise<RetentionPolicy[]>;
}

export interface DeletionJobRepository {
  save(job: DeletionJob): Promise<void>;
  findById(tenantId: TenantId, id: DeletionJobId): Promise<DeletionJob | null>;
  findByIdGlobal(id: DeletionJobId): Promise<DeletionJob | null>;
  list(tenantId: TenantId): Promise<DeletionJob[]>;
  listActiveByKind(tenantId: TenantId, kind: string, target: string): Promise<DeletionJob[]>;
  listProcessable(limit: number): Promise<DeletionJob[]>;
}

export interface AuditRepository {
  append(event: AuditEvent): Promise<void>;
  list(tenantId: TenantId, limit: number, afterId: string | null): Promise<AuditEvent[]>;
}

export interface UsageRepository {
  increment(tenantId: TenantId, periodStart: number, delta: UsageDelta): Promise<void>;
  get(tenantId: TenantId, periodStart: number): Promise<UsageRecord | null>;
  list(tenantId: TenantId, from: number, to: number): Promise<UsageRecord[]>;
}

export interface ApmRepository {
  increment(stats: EndpointStats): Promise<void>;
  query(
    tenantId: TenantId,
    from: number,
    to: number,
    service: string | null,
  ): Promise<EndpointStats[]>;
  incrementEdge(edge: ServiceEdge): Promise<void>;
  queryEdges(tenantId: TenantId, from: number, to: number): Promise<ServiceEdge[]>;
}

export interface RealtimePort {
  publish(
    tenantId: TenantId,
    entry: { streamId: string; line: string; timestamp: number },
  ): Promise<void>;
}

export interface RateLimiter {
  allow(key: string): Promise<boolean>;
}

export interface Compressor {
  gzip(data: Uint8Array): Promise<Uint8Array>;
  gunzip(data: Uint8Array): Promise<Uint8Array>;
}

export interface Checksum {
  sha256Hex(data: Uint8Array): Promise<string>;
}

export interface PlatformMetrics {
  record(name: string, value: number, labels?: Record<string, string>): void;
}

export interface MemberView {
  readonly userId: UserId;
  readonly email: string;
  readonly displayName: string;
  readonly role: Role;
}
