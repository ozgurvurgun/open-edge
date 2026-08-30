import { asEventId, type EventId, type TenantId } from "../../shared/ids.js";
import { AppError, ErrorCodes } from "../../shared/errors.js";
import {
  MAX_INGEST_BYTES,
  MAX_INGEST_EVENTS,
  MAX_LINE_LENGTH,
} from "../../domain/logs/log-stream.js";
import { createLabelSet, labelSetError } from "../../domain/logs/labels.js";
import { isValidMetricName } from "../../domain/metrics/metric.js";
import { tenantAcceptsWrites } from "../../domain/tenant/tenant.js";
import { requirePermission, type Principal } from "../authorization/policies.js";
import type { Clock, IdGenerator, QueuePort, TenantRepository, UsageRepository } from "../ports.js";
import type { TelemetryKind } from "../../domain/ingestion/event.js";
import { hourPeriodStart } from "../../domain/usage/usage-record.js";

export interface IngestDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly queue: QueuePort;
  readonly tenants: TenantRepository;
  readonly usage: UsageRepository;
}

export interface LogIngestEvent {
  eventId?: string;
  timestamp?: number;
  line: string;
  labels: Record<string, string>;
  fields?: Record<string, string>;
  traceId?: string;
  spanId?: string;
}

export interface MetricIngestEvent {
  eventId?: string;
  timestamp?: number;
  name: string;
  type: "counter" | "gauge" | "histogram";
  labels: Record<string, string>;
  value: number;
  buckets?: Record<string, number>;
  count?: number;
  sum?: number;
}

export interface TraceIngestEvent {
  eventId?: string;
  traceId: string;
  spans: Array<{
    spanId: string;
    parentSpanId?: string | null;
    service: string;
    operation: string;
    startTime: number;
    durationMs: number;
    status?: "ok" | "error";
    attributes?: Record<string, string>;
    events?: Array<{ timestamp: number; name: string; attributes?: Record<string, string> }>;
  }>;
}

function assertTenant(tenant: { status: string } | null): void {
  if (!tenant || !tenantAcceptsWrites(tenant as never)) {
    throw new AppError(ErrorCodes.TENANT_DISABLED, "Tenant is not available.", 403);
  }
}

function sizeOf(payload: unknown): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

async function enqueue(
  deps: IngestDeps,
  tenantId: TenantId,
  kind: TelemetryKind,
  events: unknown[],
): Promise<{ accepted: number; eventIds: EventId[] }> {
  if (events.length === 0) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "At least one event is required.", 400);
  }
  if (events.length > MAX_INGEST_EVENTS) {
    throw new AppError(ErrorCodes.PAYLOAD_TOO_LARGE, "Too many events in one request.", 413);
  }
  const bytes = sizeOf(events);
  if (bytes > MAX_INGEST_BYTES) {
    throw new AppError(ErrorCodes.PAYLOAD_TOO_LARGE, "Ingest payload exceeds the size limit.", 413);
  }
  const tenant = await deps.tenants.findById(tenantId);
  assertTenant(tenant);
  const now = deps.clock.now();
  const eventIds: EventId[] = [];
  for (const payload of events) {
    const eventId = asEventId(
      typeof payload === "object" &&
        payload &&
        "eventId" in payload &&
        typeof payload.eventId === "string"
        ? payload.eventId
        : deps.ids.id(),
    );
    eventIds.push(eventId);
    await deps.queue.publishIngest({
      tenantId,
      kind,
      eventId,
      receivedAt: now,
      payload,
    });
  }
  await deps.usage.increment(tenantId, hourPeriodStart(now), {
    ingestedEvents: events.length,
    ingestedBytes: bytes,
    apiRequests: 1,
  });
  return { accepted: events.length, eventIds };
}

export async function ingestLogs(deps: IngestDeps, principal: Principal, events: LogIngestEvent[]) {
  requirePermission(principal, "logs:write");
  for (const event of events) {
    if (!event.line || event.line.length > MAX_LINE_LENGTH) {
      throw new AppError(
        ErrorCodes.VALIDATION_FAILED,
        "Each log line must be 1-16384 characters.",
        400,
      );
    }
    const labels = createLabelSet(event.labels ?? {});
    const labelError = labelSetError(labels);
    if (labelError) {
      throw new AppError(ErrorCodes.CARDINALITY_EXCEEDED, labelError, 400);
    }
  }
  return enqueue(deps, principal.tenantId, "logs", events);
}

export async function ingestMetrics(
  deps: IngestDeps,
  principal: Principal,
  events: MetricIngestEvent[],
) {
  requirePermission(principal, "metrics:write");
  for (const event of events) {
    if (!isValidMetricName(event.name) || !Number.isFinite(event.value)) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, "Invalid metric sample.", 400);
    }
    const labelError = labelSetError(createLabelSet(event.labels ?? {}));
    if (labelError) {
      throw new AppError(ErrorCodes.CARDINALITY_EXCEEDED, labelError, 400);
    }
  }
  return enqueue(deps, principal.tenantId, "metrics", events);
}

export async function ingestTraces(
  deps: IngestDeps,
  principal: Principal,
  events: TraceIngestEvent[],
) {
  requirePermission(principal, "traces:write");
  for (const event of events) {
    if (!event.traceId || event.spans.length === 0) {
      throw new AppError(
        ErrorCodes.VALIDATION_FAILED,
        "Each trace must include a traceId and spans.",
        400,
      );
    }
  }
  return enqueue(deps, principal.tenantId, "traces", events);
}
