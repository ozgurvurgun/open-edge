import { DEFAULT_QUERY_LIMITS } from "../../domain/query/query-limits.js";
import { AppError, ErrorCodes } from "../../shared/errors.js";
import { mapPool } from "../../shared/map-pool.js";
import { requirePermission, type Principal } from "../authorization/policies.js";
import type {
  Clock,
  Compressor,
  MetricChunkRepository,
  MetricSeriesRepository,
  ObjectStore,
} from "../ports.js";
import type { MetricSample } from "../../domain/metrics/metric.js";
import {
  executeMetricAst,
  filterSeries,
  matrixToScalar,
  type MetricQueryResult,
} from "../../domain/metrics/query/execute.js";
import {
  leafSelector,
  MetricParseError,
  parseMetricQuery,
} from "../../domain/metrics/query/parse.js";

export type MetricQueryDeps = {
  clock: Clock;
  series: MetricSeriesRepository;
  metricChunks: MetricChunkRepository;
  objects: ObjectStore;
  compressor: Compressor;
};

function decodeSamples(bytes: Uint8Array): MetricSample[] {
  const text = new TextDecoder().decode(bytes);
  const out: MetricSample[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as MetricSample;
      if (typeof parsed.timestamp === "number" && typeof parsed.value === "number") {
        out.push(parsed);
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

export async function runMetricQuery(
  deps: MetricQueryDeps,
  principal: Principal,
  input: { query: string; start: number; end: number; stepMs?: number },
): Promise<MetricQueryResult> {
  requirePermission(principal, "metrics:read");
  const limits = DEFAULT_QUERY_LIMITS;
  if (!input.query || input.query.length > limits.maxQueryLength) {
    throw new AppError(ErrorCodes.QUERY_INVALID, "Query length is outside allowed limits.", 400);
  }
  if (input.end <= input.start || input.end - input.start > limits.maxTimeRangeMs) {
    throw new AppError(
      ErrorCodes.QUERY_LIMIT_EXCEEDED,
      "Time range is outside allowed limits.",
      400,
    );
  }

  let ast;
  try {
    ast = parseMetricQuery(input.query);
  } catch (error) {
    if (error instanceof MetricParseError) {
      throw new AppError(ErrorCodes.QUERY_INVALID, error.message, 400);
    }
    throw error;
  }

  const leaf = leafSelector(ast);
  const all = await deps.series.listByTenant(principal.tenantId, leaf.name, limits.maxStreams);
  const matched = filterSeries(all, leaf.name, leaf.matchers);
  if (matched.length === 0) {
    return { resultType: "matrix", result: [] };
  }

  const seriesIds = matched.map((s) => s.id);
  const chunks = await deps.metricChunks.listInRange(
    principal.tenantId,
    seriesIds,
    input.start,
    input.end,
  );
  if (chunks.length > limits.maxChunks) {
    throw new AppError(ErrorCodes.QUERY_LIMIT_EXCEEDED, "Query would scan too many chunks.", 400);
  }

  const samplesBySeries = new Map<string, MetricSample[]>();
  for (const id of seriesIds) samplesBySeries.set(id, []);

  const ready = chunks.filter((c) => c.status === "ready");
  const started = deps.clock.now();
  const loaded = await mapPool(ready, 8, async (chunk) => {
    if (deps.clock.now() - started > limits.maxDurationMs) {
      throw new AppError(
        ErrorCodes.QUERY_TIMEOUT,
        "Query execution exceeded the allowed limit.",
        408,
      );
    }
    const body = await deps.objects.get(chunk.objectKey);
    if (!body) return null;
    const raw = await deps.compressor.gunzip(body);
    const samples = decodeSamples(raw).filter(
      (s) => s.timestamp >= input.start && s.timestamp <= input.end,
    );
    return { seriesId: chunk.seriesId, samples };
  });
  for (const item of loaded) {
    if (!item) continue;
    const list = samplesBySeries.get(item.seriesId) ?? [];
    list.push(...item.samples);
    samplesBySeries.set(item.seriesId, list);
  }

  for (const list of samplesBySeries.values()) {
    list.sort((a, b) => a.timestamp - b.timestamp);
  }

  const seriesList = matched.map((s) => ({
    labels: { ...(s.labels.entries as Record<string, string>) },
    samples: samplesBySeries.get(s.id) ?? [],
  }));

  const rangeMs = input.end - input.start;
  const stepMs = input.stepMs ?? Math.max(1000, Math.floor(rangeMs / 60));
  return executeMetricAst(ast, seriesList, input.start, input.end, stepMs);
}

export async function metricQueryScalar(
  deps: MetricQueryDeps,
  principal: Principal,
  query: string,
  start: number,
  end: number,
): Promise<number> {
  const result = await runMetricQuery(deps, principal, { query, start, end });
  return matrixToScalar(result);
}
