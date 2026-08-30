import {
  asAlertId,
  asDashboardId,
  asDeletionJobId,
  asStreamId,
  asTraceId,
  asUserId,
} from "../../shared/ids.js";
import { AppError, ErrorCodes } from "../../shared/errors.js";
import { isValidRetentionDays, RetentionAuditActions } from "../../domain/retention/policy.js";
import { DeletionAuditActions, type DeletionTarget } from "../../domain/deletion/job.js";
import type { AlertComparator, AlertKind } from "../../domain/alerting/alert.js";
import { compareThreshold } from "../../domain/alerting/alert.js";
import { averageLatency, errorRate } from "../../domain/apm/stats.js";
import { quantileFromHist } from "../../domain/apm/histogram.js";
import { parseQuery } from "../../domain/query/parser.js";
import { validateSemantics } from "../../domain/query/semantic.js";
import { parseMetricQuery, MetricParseError } from "../../domain/metrics/query/parse.js";
import { actorUserId, requirePermission, type Principal } from "../authorization/policies.js";
import type {
  AlertRepository,
  ApmRepository,
  AuditRepository,
  Clock,
  Compressor,
  DashboardRepository,
  DeletionJobRepository,
  IdGenerator,
  LogStreamRepository,
  MetricSeriesRepository,
  ObjectStore,
  QueuePort,
  RetentionRepository,
  TraceRepository,
  UsageRepository,
} from "../ports.js";
import type { DashboardDefinition } from "../../domain/dashboard/dashboard.js";

export async function listStreams(streams: LogStreamRepository, principal: Principal) {
  requirePermission(principal, "logs:read");
  return streams.listByTenant(principal.tenantId, 200);
}

export async function getStream(streams: LogStreamRepository, principal: Principal, id: string) {
  requirePermission(principal, "logs:read");
  const stream = await streams.findById(principal.tenantId, asStreamId(id));
  if (!stream) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Log stream not found.", 404);
  }
  return stream;
}

export async function listMetricSeries(
  series: MetricSeriesRepository,
  principal: Principal,
  name: string | null,
) {
  requirePermission(principal, "metrics:read");
  return series.listByTenant(principal.tenantId, name, 200);
}

export async function listDashboards(repo: DashboardRepository, principal: Principal) {
  requirePermission(principal, "dashboards:read");
  return repo.list(principal.tenantId);
}

export async function getDashboard(repo: DashboardRepository, principal: Principal, id: string) {
  requirePermission(principal, "dashboards:read");
  const dashboard = await repo.findById(principal.tenantId, id);
  if (!dashboard) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Dashboard not found.", 404);
  }
  return dashboard;
}

export async function saveDashboard(
  deps: { dashboards: DashboardRepository; clock: Clock; ids: IdGenerator },
  principal: Principal,
  input: { id?: string; name: string; description: string; definition: DashboardDefinition },
) {
  requirePermission(principal, "dashboards:write");
  const now = deps.clock.now();
  const existing = input.id ? await deps.dashboards.findById(principal.tenantId, input.id) : null;
  const dashboard = {
    id: existing?.id ?? asDashboardId(deps.ids.id()),
    tenantId: principal.tenantId,
    name: input.name.trim(),
    description: input.description,
    definition: input.definition,
    createdBy:
      existing?.createdBy ?? (principal.kind === "session" ? principal.userId : asUserId("system")),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await deps.dashboards.save(dashboard);
  return dashboard;
}

export async function deleteDashboard(repo: DashboardRepository, principal: Principal, id: string) {
  requirePermission(principal, "dashboards:write");
  await repo.delete(principal.tenantId, id);
}

export async function listAlerts(repo: AlertRepository, principal: Principal) {
  requirePermission(principal, "alerts:read");
  const alerts = await repo.list(principal.tenantId);
  const now = Date.now();
  const silences = await repo.listActiveSilences(principal.tenantId, now);
  const out = [];
  for (const alert of alerts) {
    const state = await repo.getState(alert.id);
    const silenced = silences.some(
      (s) => (s.alertId === null || s.alertId === alert.id) && s.startsAt <= now && s.endsAt > now,
    );
    out.push({ ...alert, state: state ?? null, silenced });
  }
  return out;
}

export async function getAlertState(repo: AlertRepository, principal: Principal, id: string) {
  requirePermission(principal, "alerts:read");
  const alert = await repo.findById(principal.tenantId, id);
  if (!alert) throw new AppError(ErrorCodes.NOT_FOUND, "Alert not found.", 404);
  return (
    (await repo.getState(id)) ?? {
      alertId: alert.id,
      tenantId: alert.tenantId,
      status: "ok" as const,
      lastEvaluatedAt: null,
      lastFiredAt: null,
      lastValue: null,
    }
  );
}

export async function listAlertEvents(
  repo: AlertRepository,
  principal: Principal,
  id: string,
  limit = 50,
) {
  requirePermission(principal, "alerts:read");
  const alert = await repo.findById(principal.tenantId, id);
  if (!alert) throw new AppError(ErrorCodes.NOT_FOUND, "Alert not found.", 404);
  return repo.listEvents(principal.tenantId, id, Math.min(limit, 100));
}

export async function listSilences(repo: AlertRepository, principal: Principal) {
  requirePermission(principal, "alerts:read");
  return repo.listSilences(principal.tenantId);
}

export async function createSilence(
  deps: { alerts: AlertRepository; clock: Clock; ids: IdGenerator },
  principal: Principal,
  input: { alertId?: string | null; startsAt: number; endsAt: number; comment?: string },
) {
  requirePermission(principal, "alerts:write");
  if (input.endsAt <= input.startsAt) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "endsAt must be after startsAt.", 400);
  }
  if (input.endsAt - input.startsAt > 30 * 86_400_000) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "Silence window max 30 days.", 400);
  }
  if (input.alertId) {
    const alert = await deps.alerts.findById(principal.tenantId, input.alertId);
    if (!alert) throw new AppError(ErrorCodes.NOT_FOUND, "Alert not found.", 404);
  }
  const silence = {
    id: deps.ids.id(),
    tenantId: principal.tenantId,
    alertId: input.alertId ? asAlertId(input.alertId) : null,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    comment: (input.comment ?? "").slice(0, 512),
    createdBy: principal.kind === "session" ? principal.userId : asUserId("system"),
    createdAt: deps.clock.now(),
  };
  await deps.alerts.saveSilence(silence);
  return silence;
}

export async function deleteSilence(repo: AlertRepository, principal: Principal, id: string) {
  requirePermission(principal, "alerts:write");
  await repo.deleteSilence(principal.tenantId, id);
}

export async function saveAlert(
  deps: { alerts: AlertRepository; clock: Clock; ids: IdGenerator },
  principal: Principal,
  input: {
    id?: string;
    name: string;
    query: string;
    kind: AlertKind;
    threshold: number;
    comparator: AlertComparator;
    windowSeconds: number;
    forSeconds?: number;
    webhookUrl?: string | null;
    enabled: boolean;
  },
) {
  requirePermission(principal, "alerts:write");
  if (input.kind === "logs") {
    parseQuery(input.query);
    validateSemantics(parseQuery(input.query));
  } else {
    try {
      parseMetricQuery(input.query);
    } catch (error) {
      if (error instanceof MetricParseError) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, error.message, 400);
      }
      throw error;
    }
  }
  const webhookUrl = input.webhookUrl?.trim() || null;
  if (webhookUrl && !/^https:\/\//i.test(webhookUrl)) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "webhookUrl must be https.", 400);
  }
  const now = deps.clock.now();
  const existing = input.id ? await deps.alerts.findById(principal.tenantId, input.id) : null;
  const alert = {
    id: existing?.id ?? asAlertId(deps.ids.id()),
    tenantId: principal.tenantId,
    name: input.name.trim(),
    query: input.query,
    kind: input.kind,
    threshold: input.threshold,
    comparator: input.comparator,
    windowSeconds: input.windowSeconds,
    forSeconds: Math.max(0, input.forSeconds ?? existing?.forSeconds ?? 0),
    webhookUrl: webhookUrl === undefined ? (existing?.webhookUrl ?? null) : webhookUrl,
    enabled: input.enabled,
    createdBy:
      existing?.createdBy ?? (principal.kind === "session" ? principal.userId : asUserId("system")),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await deps.alerts.save(alert);
  return alert;
}

export async function deleteAlert(repo: AlertRepository, principal: Principal, id: string) {
  requirePermission(principal, "alerts:write");
  await repo.delete(principal.tenantId, id);
}

export async function getRetention(repo: RetentionRepository, principal: Principal) {
  const policy = await repo.find(principal.tenantId);
  if (!policy) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Retention policy not found.", 404);
  }
  return policy;
}

export async function updateRetention(
  deps: { retention: RetentionRepository; audit: AuditRepository; clock: Clock; ids: IdGenerator },
  principal: Principal,
  input: { logsDays: number; metricsDays: number; tracesDays: number },
) {
  requirePermission(principal, "retention:write");
  if (
    !isValidRetentionDays(input.logsDays) ||
    !isValidRetentionDays(input.metricsDays) ||
    !isValidRetentionDays(input.tracesDays)
  ) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "Invalid retention period.", 400);
  }
  const now = deps.clock.now();
  const policy = {
    tenantId: principal.tenantId,
    logsDays: input.logsDays,
    metricsDays: input.metricsDays,
    tracesDays: input.tracesDays,
    updatedAt: now,
    updatedBy: principal.kind === "session" ? principal.userId : asUserId("system"),
  };
  await deps.retention.save(policy);
  await deps.audit.append({
    id: deps.ids.id(),
    tenantId: principal.tenantId,
    actorUserId: actorUserId(principal),
    action: RetentionAuditActions.RETENTION_CHANGED,
    resourceType: "retention",
    resourceId: principal.tenantId,
    metadata: {},
    ipHash: null,
    createdAt: now,
  });
  return policy;
}

export async function requestDeletion(
  deps: {
    jobs: DeletionJobRepository;
    queue: QueuePort;
    audit: AuditRepository;
    clock: Clock;
    ids: IdGenerator;
  },
  principal: Principal,
  target: DeletionTarget,
) {
  requirePermission(principal, "deletion:write");
  const now = deps.clock.now();
  const job = {
    id: asDeletionJobId(deps.ids.id()),
    tenantId: principal.tenantId,
    kind: "user_requested" as const,
    target,
    status: "pending" as const,
    cursor: null,
    requestedBy: actorUserId(principal),
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  await deps.jobs.save(job);
  await deps.queue.publishDeletion({ jobId: job.id, tenantId: principal.tenantId });
  await deps.audit.append({
    id: deps.ids.id(),
    tenantId: principal.tenantId,
    actorUserId: actorUserId(principal),
    action: DeletionAuditActions.DELETION_REQUESTED,
    resourceType: "deletion_job",
    resourceId: job.id,
    metadata: { target },
    ipHash: null,
    createdAt: now,
  });
  return job;
}

export async function getDeletionJob(
  repo: DeletionJobRepository,
  principal: Principal,
  id: string,
) {
  requirePermission(principal, "deletion:write");
  const job = await repo.findById(principal.tenantId, asDeletionJobId(id));
  if (!job) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Deletion job not found.", 404);
  }
  return job;
}

export async function listDeletionJobs(repo: DeletionJobRepository, principal: Principal) {
  requirePermission(principal, "deletion:write");
  return repo.list(principal.tenantId);
}

export async function searchTraces(
  repo: TraceRepository,
  principal: Principal,
  filters: {
    start: number;
    end: number;
    service?: string;
    operation?: string;
    status?: "ok" | "error";
    minDurationMs?: number;
    limit?: number;
  },
) {
  requirePermission(principal, "traces:read");
  return repo.search(principal.tenantId, { ...filters, limit: Math.min(filters.limit ?? 50, 100) });
}

export async function getTrace(
  deps: { traces: TraceRepository; objects: ObjectStore; compressor: Compressor },
  principal: Principal,
  traceId: string,
) {
  requirePermission(principal, "traces:read");
  const trace = await deps.traces.findById(principal.tenantId, asTraceId(traceId));
  if (!trace) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Trace not found.", 404);
  }
  let spans: unknown = [];
  if (trace.objectKey) {
    const body = await deps.objects.get(trace.objectKey);
    if (body) {
      spans = JSON.parse(new TextDecoder().decode(await deps.compressor.gunzip(body)));
    }
  }
  return { trace, spans };
}

export async function apmOverview(
  repo: ApmRepository,
  principal: Principal,
  from: number,
  to: number,
) {
  requirePermission(principal, "traces:read");
  const rows = await repo.query(principal.tenantId, from, to, null);
  const requestCount = rows.reduce((s, r) => s + r.requestCount, 0);
  const errorCount = rows.reduce((s, r) => s + r.errorCount, 0);
  const durationSum = rows.reduce((s, r) => s + r.durationSumMs, 0);
  const merged = rows.reduce(
    (acc, r) => {
      const h = r.durationHist ?? {};
      for (const [k, v] of Object.entries(h)) acc[k] = (acc[k] ?? 0) + v;
      return acc;
    },
    {} as Record<string, number>,
  );
  return {
    requestCount,
    errorCount,
    errorRate: requestCount === 0 ? 0 : errorCount / requestCount,
    averageLatencyMs: requestCount === 0 ? 0 : durationSum / requestCount,
    p50Ms: quantileFromHist(merged, 0.5),
    p95Ms: quantileFromHist(merged, 0.95),
    p99Ms: quantileFromHist(merged, 0.99),
    services: [...new Set(rows.map((r) => r.service))],
  };
}

export async function apmEndpoints(
  repo: ApmRepository,
  principal: Principal,
  from: number,
  to: number,
  service: string | null,
) {
  requirePermission(principal, "traces:read");
  const rows = await repo.query(principal.tenantId, from, to, service);
  return rows
    .map((r) => ({
      service: r.service,
      operation: r.operation,
      requestCount: r.requestCount,
      errorCount: r.errorCount,
      errorRate: errorRate(r),
      averageLatencyMs: averageLatency(r),
      maxLatencyMs: r.durationMaxMs,
      p50Ms: quantileFromHist(r.durationHist ?? {}, 0.5),
      p95Ms: quantileFromHist(r.durationHist ?? {}, 0.95),
      p99Ms: quantileFromHist(r.durationHist ?? {}, 0.99),
    }))
    .sort((a, b) => b.requestCount - a.requestCount);
}

export async function apmServiceMap(
  repo: ApmRepository,
  principal: Principal,
  from: number,
  to: number,
) {
  requirePermission(principal, "traces:read");
  const edges = await repo.queryEdges(principal.tenantId, from, to);
  const collapsed = new Map<string, { from: string; to: string; calls: number; errors: number }>();
  for (const e of edges) {
    const key = `${e.fromService}->${e.toService}`;
    const cur = collapsed.get(key) ?? {
      from: e.fromService,
      to: e.toService,
      calls: 0,
      errors: 0,
    };
    cur.calls += e.callCount;
    cur.errors += e.errorCount;
    collapsed.set(key, cur);
  }
  return { edges: [...collapsed.values()] };
}

export async function getUsage(
  repo: UsageRepository,
  principal: Principal,
  from: number,
  to: number,
) {
  requirePermission(principal, "usage:read");
  return repo.list(principal.tenantId, from, to);
}

export async function listAudit(
  repo: AuditRepository,
  principal: Principal,
  limit: number,
  afterId: string | null,
) {
  requirePermission(principal, "audit:read");
  return repo.list(principal.tenantId, Math.min(limit, 100), afterId);
}

export function evaluateAlertValue(
  value: number,
  comparator: AlertComparator,
  threshold: number,
): boolean {
  return compareThreshold(value, comparator, threshold);
}
