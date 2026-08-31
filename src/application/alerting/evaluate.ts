import {
  compareThreshold,
  type Alert,
  type AlertEvent,
  type AlertState,
  type AlertStateStatus,
} from "../../domain/alerting/alert.js";
import { asApiKeyId, asTenantId, type TenantId } from "../../shared/ids.js";
import type { Principal } from "../authorization/policies.js";
import type {
  AlertRepository,
  Clock,
  Compressor,
  IdGenerator,
  LogChunkRepository,
  LogStreamRepository,
  MetricChunkRepository,
  MetricSeriesRepository,
  ObjectStore,
  CacheStore,
  PlatformMetrics,
  UsageRepository,
} from "../ports.js";
import { runLogQuery, type QueryDeps } from "../query/run-log-query.js";
import { metricQueryScalar, type MetricQueryDeps } from "../query/run-metric-query.js";
import { silenceIsActive } from "../../domain/alerting/silence.js";
import type { Env } from "../../env.js";

export type AlertEvalDeps = {
  alerts: AlertRepository;
  clock: Clock;
  ids: IdGenerator;
  streams: LogStreamRepository;
  chunks: LogChunkRepository;
  objects: ObjectStore;
  compressor: Compressor;
  cache: CacheStore;
  usage: UsageRepository;
  metrics: PlatformMetrics;
  series: MetricSeriesRepository;
  metricChunks: MetricChunkRepository;
  env: Env;
  fetchImpl?: typeof fetch;
};

function systemPrincipal(tenantId: TenantId): Principal {
  return {
    kind: "apiKey",
    tenantId,
    apiKeyId: asApiKeyId("system-alert-eval"),
    scopes: ["logs:read", "metrics:read"],
  };
}

async function tryLock(
  env: Env,
  tenantId: TenantId,
  alertId: string,
  until: number,
): Promise<boolean> {
  try {
    const id = env.ALERT_COORDINATOR.idFromName(tenantId);
    const stub = env.ALERT_COORDINATOR.get(id);
    const res = await stub.fetch("https://alert-coordinator/lock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alertId, until }),
    });
    if (!res.ok) return true; // fail open
    const body = (await res.json()) as { acquired?: boolean };
    return body.acquired !== false;
  } catch {
    return true;
  }
}

async function evaluateValue(
  deps: AlertEvalDeps,
  alert: Alert,
  now: number,
): Promise<number | null> {
  const start = now - alert.windowSeconds * 1000;
  const principal = systemPrincipal(alert.tenantId);
  if (alert.kind === "logs") {
    const logDeps: QueryDeps = {
      clock: deps.clock,
      streams: deps.streams,
      chunks: deps.chunks,
      objects: deps.objects,
      compressor: deps.compressor,
      cache: deps.cache,
      usage: deps.usage,
      metrics: deps.metrics,
    };
    const q =
      alert.query.includes("count_over_time") || alert.query.includes("rate(")
        ? alert.query
        : `count_over_time(${alert.query}[${alert.windowSeconds}s])`;
    try {
      const result = await runLogQuery(logDeps, principal, {
        query: q,
        start,
        end: now,
        limit: 5000,
      });
      if (result.series.length > 0) {
        return result.series.reduce((a, p) => a + p.value, 0);
      }
      return result.hits.length;
    } catch {
      return null;
    }
  }
  const metricDeps: MetricQueryDeps = {
    clock: deps.clock,
    series: deps.series,
    metricChunks: deps.metricChunks,
    objects: deps.objects,
    compressor: deps.compressor,
  };
  try {
    return await metricQueryScalar(metricDeps, principal, alert.query, start, now);
  } catch {
    return null;
  }
}

async function notifyWebhook(
  fetchImpl: typeof fetch,
  url: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "open-edge-alerts/1" },
      body: JSON.stringify(payload),
    });
  } catch {
    /* best-effort */
  }
}

function nextStatus(
  alert: Alert,
  breached: boolean,
  prev: AlertState | null,
  now: number,
): AlertStateStatus {
  if (!breached) return "ok";
  if (alert.forSeconds <= 0) return "firing";
  if (prev?.status === "firing") return "firing";
  if (prev?.status === "pending" && prev.lastEvaluatedAt) {
    const pendingSince = prev.lastFiredAt ?? prev.lastEvaluatedAt ?? now;
    if (now - pendingSince >= alert.forSeconds * 1000) return "firing";
    return "pending";
  }
  return "pending";
}

export async function evaluateAllAlerts(deps: AlertEvalDeps): Promise<{ evaluated: number }> {
  const alerts = await deps.alerts.listEnabled();
  const now = deps.clock.now();
  const fetchImpl = deps.fetchImpl ?? fetch;
  let evaluated = 0;

  const byTenant = new Map<string, Alert[]>();
  for (const a of alerts) {
    const list = byTenant.get(a.tenantId) ?? [];
    list.push(a);
    byTenant.set(a.tenantId, list);
  }

  for (const [tenantId, list] of byTenant) {
    for (const alert of list) {
      const acquired = await tryLock(deps.env, asTenantId(tenantId), alert.id, now + 50_000);
      if (!acquired) continue;

      const value = await evaluateValue(deps, alert, now);
      const prev = await deps.alerts.getState(alert.id);

      // Query failure is not a measurement. Keep prior status/value so broken
      // queries do not false-fire (< threshold) or silently stay green forever
      // while being treated as "value is 0".
      if (value === null) {
        await deps.alerts.saveState({
          alertId: alert.id,
          tenantId: alert.tenantId,
          status: prev?.status ?? "ok",
          lastEvaluatedAt: now,
          lastFiredAt: prev?.lastFiredAt ?? null,
          lastValue: prev?.lastValue ?? null,
        });
        evaluated += 1;
        continue;
      }

      const silences = await deps.alerts.listActiveSilences(alert.tenantId, now);
      const silenced = silences.some((s) => silenceIsActive(s, now, alert.id));

      const breached = compareThreshold(value, alert.comparator, alert.threshold);
      const status = nextStatus(alert, breached, prev, now);

      let lastFiredAt = prev?.lastFiredAt ?? null;
      if (status === "pending" && prev?.status !== "pending") {
        lastFiredAt = now;
      }
      if (status === "firing") {
        lastFiredAt = now;
      }
      if (status === "ok") {
        lastFiredAt = prev?.status === "firing" ? prev.lastFiredAt : null;
      }

      const state: AlertState = {
        alertId: alert.id,
        tenantId: alert.tenantId,
        status,
        lastEvaluatedAt: now,
        lastFiredAt,
        lastValue: value,
      };
      await deps.alerts.saveState(state);

      const transitioned = !prev || prev.status !== status;
      if (
        !silenced &&
        transitioned &&
        (status === "firing" || (prev?.status === "firing" && status === "ok"))
      ) {
        const event: AlertEvent = {
          id: deps.ids.id(),
          tenantId: alert.tenantId,
          alertId: alert.id,
          status,
          value,
          createdAt: now,
        };
        await deps.alerts.appendEvent(event);
        if (alert.webhookUrl) {
          await notifyWebhook(fetchImpl, alert.webhookUrl, {
            alertId: alert.id,
            name: alert.name,
            status,
            value,
            threshold: alert.threshold,
            comparator: alert.comparator,
            query: alert.query,
            tenantId: alert.tenantId,
            evaluatedAt: now,
          });
        }
      }
      evaluated += 1;
    }
  }
  return { evaluated };
}
