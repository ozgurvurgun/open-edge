import {
  createLabelSet,
  fingerprintLabels,
  MAX_STREAMS_PER_TENANT,
} from "../../domain/logs/labels.js";
import {
  MAX_SERIES_PER_TENANT,
  type MetricSample,
  type MetricType,
} from "../../domain/metrics/metric.js";
import { rootSpan, traceStatus, type Span } from "../../domain/tracing/trace.js";
import { logObjectKey, metricObjectKey, traceObjectKey } from "../../domain/ingestion/event.js";
import { hourPeriodStart } from "../../domain/usage/usage-record.js";
import { emptyLatencyHist, observeLatency } from "../../domain/apm/histogram.js";
import {
  asChunkId,
  asEventId,
  asSeriesId,
  asStreamId,
  asTenantId,
  asTraceId,
  type EventId,
  type TenantId,
} from "../../shared/ids.js";
import type { IngestQueueMessage } from "../ports.js";
import type {
  ApmRepository,
  Checksum,
  Clock,
  Compressor,
  DedupRepository,
  IdGenerator,
  LogChunkRepository,
  LogStreamRepository,
  MetricChunkRepository,
  MetricSeriesRepository,
  ObjectStore,
  PlatformMetrics,
  RealtimePort,
  TraceRepository,
  UsageRepository,
} from "../ports.js";
import type { LogEntry, LogStream } from "../../domain/logs/log-stream.js";
import type { MetricSeries } from "../../domain/metrics/metric.js";

export interface ConsumeDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly dedup: DedupRepository;
  readonly streams: LogStreamRepository;
  readonly chunks: LogChunkRepository;
  readonly series: MetricSeriesRepository;
  readonly metricChunks: MetricChunkRepository;
  readonly traces: TraceRepository;
  readonly objects: ObjectStore;
  readonly compressor: Compressor;
  readonly checksum: Checksum;
  readonly realtime: RealtimePort;
  readonly usage: UsageRepository;
  readonly apm: ApmRepository;
  readonly metrics: PlatformMetrics;
}

interface LogPayload {
  timestamp?: number;
  line: string;
  labels: Record<string, string>;
  fields?: Record<string, string>;
  traceId?: string;
  spanId?: string;
}

interface MetricPayload {
  timestamp?: number;
  name: string;
  type: MetricType;
  labels: Record<string, string>;
  value: number;
  buckets?: Record<string, number>;
  count?: number;
  sum?: number;
}

interface TracePayload {
  traceId: string;
  spans: Span[];
}

export async function consumeIngestBatch(
  deps: ConsumeDeps,
  messages: IngestQueueMessage[],
): Promise<void> {
  const fresh: IngestQueueMessage[] = [];
  for (const message of messages) {
    const tenantId = asTenantId(message.tenantId);
    const eventId = asEventId(message.eventId);
    if (await deps.dedup.seen(tenantId, eventId)) {
      continue;
    }
    fresh.push(message);
  }

  const logs = fresh.filter((m) => m.kind === "logs");
  const metrics = fresh.filter((m) => m.kind === "metrics");
  const traces = fresh.filter((m) => m.kind === "traces");

  const logsByTenant = groupBy(logs, (m) => m.tenantId);
  for (const [tenantId, group] of logsByTenant) {
    await consumeLogGroup(deps, asTenantId(tenantId), group);
  }
  const metricsByTenant = groupBy(metrics, (m) => m.tenantId);
  for (const [tenantId, group] of metricsByTenant) {
    await consumeMetricGroup(deps, asTenantId(tenantId), group);
  }
  for (const message of traces) {
    await consumeTrace(
      deps,
      asTenantId(message.tenantId),
      message.payload as TracePayload,
      message.receivedAt,
    );
    await deps.dedup.remember(
      asTenantId(message.tenantId),
      asEventId(message.eventId),
      deps.clock.now(),
    );
  }
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}

async function consumeLogGroup(
  deps: ConsumeDeps,
  tenantId: TenantId,
  messages: IngestQueueMessage[],
): Promise<void> {
  const now = deps.clock.now();
  const byFingerprint = new Map<
    string,
    { stream: LogStream; entries: LogEntry[]; eventIds: EventId[] }
  >();
  for (const message of messages) {
    const payload = message.payload as LogPayload;
    const labels = createLabelSet(payload.labels);
    const fingerprint = fingerprintLabels(labels);
    let bucket = byFingerprint.get(fingerprint);
    if (!bucket) {
      let stream = await deps.streams.findByFingerprint(tenantId, fingerprint);
      if (!stream) {
        if ((await deps.streams.countByTenant(tenantId)) >= MAX_STREAMS_PER_TENANT) {
          deps.metrics.record("cardinality_rejected", 1, { kind: "logs" });
          await deps.dedup.remember(tenantId, asEventId(message.eventId), now);
          continue;
        }
        stream = {
          id: asStreamId(deps.ids.id()),
          tenantId,
          fingerprint,
          labels,
          createdAt: now,
          lastSeenAt: now,
        };
      } else {
        stream = { ...stream, lastSeenAt: now };
      }
      await deps.streams.save(stream);
      bucket = { stream, entries: [], eventIds: [] };
      byFingerprint.set(fingerprint, bucket);
    }
    bucket.entries.push({
      timestamp: payload.timestamp ?? message.receivedAt,
      line: payload.line,
      fields: payload.fields ?? {},
      traceId: payload.traceId ?? null,
      spanId: payload.spanId ?? null,
    });
    bucket.eventIds.push(asEventId(message.eventId));
  }

  for (const bucket of byFingerprint.values()) {
    if (bucket.entries.length === 0) {
      continue;
    }
    bucket.entries.sort((a, b) => a.timestamp - b.timestamp);
    const ndjson = bucket.entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
    const compressed = await deps.compressor.gzip(new TextEncoder().encode(ndjson));
    const chunkId = asChunkId(stableId(deps, bucket.eventIds));
    const startTime = bucket.entries[0]!.timestamp;
    const endTime = bucket.entries[bucket.entries.length - 1]!.timestamp;
    const objectKey = logObjectKey(tenantId, bucket.stream.id, chunkId, startTime);
    const chunk = {
      id: chunkId,
      tenantId,
      streamId: bucket.stream.id,
      startTime,
      endTime,
      entryCount: bucket.entries.length,
      compressedSize: compressed.byteLength,
      checksum: await deps.checksum.sha256Hex(compressed),
      objectKey,
      status: "pending" as const,
      createdAt: now,
    };
    await deps.chunks.save(chunk);
    await deps.objects.put(objectKey, compressed);
    await deps.chunks.save({ ...chunk, status: "ready" });
    await deps.usage.increment(tenantId, hourPeriodStart(now), {
      storedBytes: compressed.byteLength,
    });
    for (const entry of bucket.entries) {
      await deps.realtime.publish(tenantId, {
        streamId: bucket.stream.id,
        line: entry.line,
        timestamp: entry.timestamp,
      });
    }
    for (const eventId of bucket.eventIds) {
      await deps.dedup.remember(tenantId, eventId, now);
    }
  }
}

async function consumeMetricGroup(
  deps: ConsumeDeps,
  tenantId: TenantId,
  messages: IngestQueueMessage[],
): Promise<void> {
  const now = deps.clock.now();
  const byFingerprint = new Map<
    string,
    { series: MetricSeries; samples: MetricSample[]; eventIds: EventId[] }
  >();
  for (const message of messages) {
    const payload = message.payload as MetricPayload;
    const labels = createLabelSet(payload.labels);
    const fingerprint = `${payload.name}|${fingerprintLabels(labels)}`;
    let bucket = byFingerprint.get(fingerprint);
    if (!bucket) {
      let series = await deps.series.findByFingerprint(tenantId, fingerprint);
      if (!series) {
        if ((await deps.series.countByTenant(tenantId)) >= MAX_SERIES_PER_TENANT) {
          deps.metrics.record("cardinality_rejected", 1, { kind: "metrics" });
          await deps.dedup.remember(tenantId, asEventId(message.eventId), now);
          continue;
        }
        series = {
          id: asSeriesId(deps.ids.id()),
          tenantId,
          name: payload.name,
          type: payload.type,
          labels,
          fingerprint,
          createdAt: now,
          lastSeenAt: now,
        };
      } else {
        series = { ...series, lastSeenAt: now };
      }
      await deps.series.save(series);
      bucket = { series, samples: [], eventIds: [] };
      byFingerprint.set(fingerprint, bucket);
    }
    bucket.samples.push({
      timestamp: payload.timestamp ?? message.receivedAt,
      value: payload.value,
      buckets: payload.buckets,
      count: payload.count,
      sum: payload.sum,
    });
    bucket.eventIds.push(asEventId(message.eventId));
  }
  for (const bucket of byFingerprint.values()) {
    if (bucket.samples.length === 0) {
      continue;
    }
    bucket.samples.sort((a, b) => a.timestamp - b.timestamp);
    const body = bucket.samples.map((s) => JSON.stringify(s)).join("\n") + "\n";
    const compressed = await deps.compressor.gzip(new TextEncoder().encode(body));
    const chunkId = asChunkId(stableId(deps, bucket.eventIds));
    const startTime = bucket.samples[0]!.timestamp;
    const endTime = bucket.samples[bucket.samples.length - 1]!.timestamp;
    const objectKey = metricObjectKey(tenantId, bucket.series.id, chunkId, startTime);
    const chunk = {
      id: chunkId,
      tenantId,
      seriesId: bucket.series.id,
      startTime,
      endTime,
      sampleCount: bucket.samples.length,
      compressedSize: compressed.byteLength,
      checksum: await deps.checksum.sha256Hex(compressed),
      objectKey,
      status: "pending" as const,
      createdAt: now,
    };
    await deps.metricChunks.save(chunk);
    await deps.objects.put(objectKey, compressed);
    await deps.metricChunks.save({ ...chunk, status: "ready" });
    for (const eventId of bucket.eventIds) {
      await deps.dedup.remember(tenantId, eventId, now);
    }
  }
}

async function consumeTrace(
  deps: ConsumeDeps,
  tenantId: TenantId,
  payload: TracePayload,
  receivedAt: number,
): Promise<void> {
  const spans: Span[] = payload.spans.map((s) => ({
    ...s,
    traceId: asTraceId(payload.traceId),
    parentSpanId: s.parentSpanId ?? null,
    status: s.status ?? "ok",
    attributes: s.attributes ?? {},
    events: (s.events ?? []).map((e) => ({ ...e, attributes: e.attributes ?? {} })),
  }));
  const root = rootSpan(spans);
  const start = Math.min(...spans.map((s) => s.startTime), receivedAt);
  const end = Math.max(...spans.map((s) => s.startTime + s.durationMs), start);
  const now = deps.clock.now();
  const objectKey = traceObjectKey(tenantId, payload.traceId, start);
  const compressed = await deps.compressor.gzip(new TextEncoder().encode(JSON.stringify(spans)));
  await deps.objects.put(objectKey, compressed);
  await deps.traces.save(
    {
      id: asTraceId(payload.traceId),
      tenantId,
      rootService: root?.service ?? "unknown",
      rootOperation: root?.operation ?? "unknown",
      startTime: start,
      durationMs: end - start,
      spanCount: spans.length,
      status: traceStatus(spans),
      objectKey,
      createdAt: now,
    },
    spans,
  );
  const period = hourPeriodStart(start);
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  for (const span of spans) {
    const isRoot = !span.parentSpanId;
    if (isRoot) {
      await deps.apm.increment({
        tenantId,
        service: span.service,
        operation: span.operation,
        periodStart: period,
        requestCount: 1,
        errorCount: span.status === "error" ? 1 : 0,
        durationSumMs: span.durationMs,
        durationMaxMs: span.durationMs,
        durationHist: observeLatency(emptyLatencyHist(), span.durationMs),
      });
    }
    if (span.parentSpanId) {
      const parent = byId.get(span.parentSpanId);
      const fromService =
        parent?.service ?? span.attributes?.["peer"] ?? span.attributes?.["http.host"] ?? null;
      const toService = span.service;
      if (fromService) {
        await deps.apm.incrementEdge({
          tenantId,
          fromService,
          toService,
          periodStart: period,
          callCount: 1,
          errorCount: span.status === "error" ? 1 : 0,
        });
      }
    } else {
      const peer = span.attributes?.peer || span.attributes?.["http.url"];
      if (peer) {
        let host = peer;
        try {
          host = new URL(peer).host || peer;
        } catch {
          /* keep */
        }
        if (host && host !== span.service) {
          await deps.apm.incrementEdge({
            tenantId,
            fromService: span.service,
            toService: host.slice(0, 128),
            periodStart: period,
            callCount: 1,
            errorCount: span.status === "error" ? 1 : 0,
          });
        }
      }
    }
  }
}

function stableId(deps: ConsumeDeps, eventIds: EventId[]): string {
  return [...eventIds].sort().join("").slice(0, 32) || deps.ids.id();
}
