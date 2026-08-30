import type { PipelineStage, Selector } from "./ast.js";
import { compileSafeRegex } from "./query-limits.js";
import type { LogEntry } from "../logs/log-stream.js";
import type { ExecutionPlan } from "./planner.js";

export interface LogHit {
  readonly timestamp: number;
  readonly line: string;
  readonly streamId: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly fields: Readonly<Record<string, string>>;
  readonly traceId: string | null;
  readonly spanId: string | null;
}

export interface AggregationPoint {
  readonly timestamp: number;
  readonly value: number;
}

export interface QueryResult {
  readonly hits: readonly LogHit[];
  readonly series: readonly AggregationPoint[];
  readonly scannedChunks: number;
  readonly truncated: boolean;
}

function applyJson(line: string, fields: Record<string, string>): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(line);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const next = { ...fields };
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          next[k] = String(v);
        }
      }
      return next;
    }
  } catch {
    return fields;
  }
  return fields;
}

export function entryPassesPipeline(
  entry: LogEntry,
  pipeline: readonly PipelineStage[],
): LogEntry | null {
  let fields = { ...entry.fields };
  const line = entry.line;
  for (const stage of pipeline) {
    if (stage.type === "lineContains" && !line.includes(stage.value)) {
      return null;
    }
    if (stage.type === "lineRegex") {
      const re = compileSafeRegex(stage.value);
      if (!re || !re.test(line)) {
        return null;
      }
    }
    if (stage.type === "json") {
      fields = applyJson(line, fields);
    }
    if (stage.type === "structured") {
      const actual = fields[stage.field];
      if (stage.op === "=" && actual !== stage.value) {
        return null;
      }
      if (stage.op === "!=" && actual === stage.value) {
        return null;
      }
    }
  }
  return { ...entry, fields, line };
}

export function executeEntries(
  plan: ExecutionPlan,
  byStream: ReadonlyMap<
    string,
    { labels: Readonly<Record<string, string>>; entries: readonly LogEntry[] }
  >,
  maxRows: number,
): QueryResult {
  const hits: LogHit[] = [];
  let truncated = false;
  const selector: Selector = plan.selector;
  for (const streamId of plan.streamIds) {
    const bundle = byStream.get(streamId);
    if (!bundle) {
      continue;
    }
    for (const entry of bundle.entries) {
      if (entry.timestamp < plan.range.start || entry.timestamp > plan.range.end) {
        continue;
      }
      const passed = entryPassesPipeline(entry, selector.pipeline);
      if (!passed) {
        continue;
      }
      if (hits.length >= maxRows) {
        truncated = true;
        break;
      }
      hits.push({
        timestamp: passed.timestamp,
        line: passed.line,
        streamId,
        labels: bundle.labels,
        fields: passed.fields,
        traceId: passed.traceId,
        spanId: passed.spanId,
      });
    }
  }
  hits.sort((a, b) => a.timestamp - b.timestamp);

  if (plan.aggregation === "none") {
    return { hits, series: [], scannedChunks: plan.chunkKeys.length, truncated };
  }

  const step = Math.max(plan.stepMs, 1000);
  const buckets = new Map<number, number>();
  for (const hit of hits) {
    const bucket = Math.floor(hit.timestamp / step) * step;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  const series: AggregationPoint[] = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([timestamp, count]) => ({
      timestamp,
      value: plan.aggregation === "rate" ? count / (step / 1000) : count,
    }));
  return { hits: [], series, scannedChunks: plan.chunkKeys.length, truncated };
}
