import type { LogIngestEvent, MetricIngestEvent, TraceIngestEvent } from "../ingestion/ingest.js";

type Attr = { key?: string; value?: Record<string, unknown> };

function attrString(value: Record<string, unknown> | undefined): string {
  if (!value) return "";
  if (typeof value.stringValue === "string") return value.stringValue;
  if (typeof value.intValue === "string" || typeof value.intValue === "number") {
    return String(value.intValue);
  }
  if (typeof value.doubleValue === "number") return String(value.doubleValue);
  if (typeof value.boolValue === "boolean") return value.boolValue ? "true" : "false";
  return "";
}

function attrsToRecord(attrs: Attr[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of attrs ?? []) {
    if (!a.key) continue;
    const v = attrString(a.value);
    if (v) out[a.key.replace(/\./g, "_")] = v.slice(0, 256);
  }
  return out;
}

function nanoToMs(nano: string | number | undefined): number {
  if (nano === undefined || nano === null) return Date.now();
  const n = typeof nano === "string" ? Number(nano) : nano;
  if (!Number.isFinite(n)) return Date.now();
  return Math.floor(n / 1_000_000);
}

function resourceService(resource: { attributes?: Attr[] } | undefined): string {
  const attrs = attrsToRecord(resource?.attributes);
  return attrs["service_name"] || attrs["service.name"] || "otlp";
}

export function mapOtlpLogs(body: {
  resourceLogs?: Array<{
    resource?: { attributes?: Attr[] };
    scopeLogs?: Array<{
      logRecords?: Array<{
        timeUnixNano?: string | number;
        body?: { stringValue?: string };
        attributes?: Attr[];
        traceId?: string;
        spanId?: string;
        severityText?: string;
      }>;
    }>;
  }>;
}): LogIngestEvent[] {
  const events: LogIngestEvent[] = [];
  for (const rl of body.resourceLogs ?? []) {
    const service = resourceService(rl.resource);
    const base = attrsToRecord(rl.resource?.attributes);
    for (const sl of rl.scopeLogs ?? []) {
      for (const lr of sl.logRecords ?? []) {
        const line = lr.body?.stringValue ?? "";
        if (!line) continue;
        const fields = attrsToRecord(lr.attributes);
        if (lr.severityText) fields.severity = lr.severityText;
        events.push({
          timestamp: nanoToMs(lr.timeUnixNano),
          line: line.slice(0, 16_384),
          labels: {
            service,
            env: base.deployment_environment || base["deployment_environment"] || "default",
            level: (fields.severity || fields.level || "info").toLowerCase(),
          },
          fields,
          traceId: lr.traceId || undefined,
          spanId: lr.spanId || undefined,
        });
      }
    }
  }
  return events;
}

export function mapOtlpTraces(body: {
  resourceSpans?: Array<{
    resource?: { attributes?: Attr[] };
    scopeSpans?: Array<{
      spans?: Array<{
        traceId?: string;
        spanId?: string;
        parentSpanId?: string;
        name?: string;
        startTimeUnixNano?: string | number;
        endTimeUnixNano?: string | number;
        status?: { code?: number };
        attributes?: Attr[];
      }>;
    }>;
  }>;
}): TraceIngestEvent[] {
  const byTrace = new Map<string, TraceIngestEvent>();
  for (const rs of body.resourceSpans ?? []) {
    const service = resourceService(rs.resource);
    for (const ss of rs.scopeSpans ?? []) {
      for (const sp of ss.spans ?? []) {
        if (!sp.traceId || !sp.spanId || !sp.name) continue;
        const start = nanoToMs(sp.startTimeUnixNano);
        const end = nanoToMs(sp.endTimeUnixNano);
        const statusCode = sp.status?.code ?? 0;
        const status = statusCode === 2 ? "error" : "ok";
        let event = byTrace.get(sp.traceId);
        if (!event) {
          event = { traceId: sp.traceId, spans: [] };
          byTrace.set(sp.traceId, event);
        }
        event.spans.push({
          spanId: sp.spanId,
          parentSpanId: sp.parentSpanId || null,
          service,
          operation: sp.name,
          startTime: start,
          durationMs: Math.max(0, end - start),
          status,
          attributes: attrsToRecord(sp.attributes),
        });
      }
    }
  }
  return [...byTrace.values()];
}

export function mapOtlpMetrics(body: {
  resourceMetrics?: Array<{
    resource?: { attributes?: Attr[] };
    scopeMetrics?: Array<{
      metrics?: Array<{
        name?: string;
        sum?: {
          dataPoints?: Array<{
            asDouble?: number;
            asInt?: string | number;
            timeUnixNano?: string | number;
            attributes?: Attr[];
          }>;
        };
        gauge?: {
          dataPoints?: Array<{
            asDouble?: number;
            asInt?: string | number;
            timeUnixNano?: string | number;
            attributes?: Attr[];
          }>;
        };
      }>;
    }>;
  }>;
}): MetricIngestEvent[] {
  const events: MetricIngestEvent[] = [];
  for (const rm of body.resourceMetrics ?? []) {
    const service = resourceService(rm.resource);
    const base = attrsToRecord(rm.resource?.attributes);
    for (const sm of rm.scopeMetrics ?? []) {
      for (const metric of sm.metrics ?? []) {
        if (!metric.name) continue;
        const points = [...(metric.sum?.dataPoints ?? []), ...(metric.gauge?.dataPoints ?? [])];
        const type = metric.sum ? "counter" : "gauge";
        for (const dp of points) {
          const value = typeof dp.asDouble === "number" ? dp.asDouble : Number(dp.asInt ?? NaN);
          if (!Number.isFinite(value)) continue;
          events.push({
            name: metric.name.replace(/\./g, "_"),
            type,
            value,
            timestamp: nanoToMs(dp.timeUnixNano),
            labels: {
              service,
              env: base.deployment_environment || "default",
              ...attrsToRecord(dp.attributes),
            },
          });
        }
      }
    }
  }
  return events;
}
