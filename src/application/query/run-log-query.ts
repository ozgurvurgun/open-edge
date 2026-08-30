import { DEFAULT_QUERY_LIMITS } from "../../domain/query/query-limits.js";
import { parseQuery } from "../../domain/query/parser.js";
import { ParseError } from "../../domain/query/parser.js";
import { SemanticError, validateSemantics } from "../../domain/query/semantic.js";
import { buildPlan } from "../../domain/query/planner.js";
import { executeEntries, type QueryResult } from "../../domain/query/executor.js";
import type { LogEntry } from "../../domain/logs/log-stream.js";
import { AppError, ErrorCodes } from "../../shared/errors.js";
import { hourPeriodStart } from "../../domain/usage/usage-record.js";
import { requirePermission, type Principal } from "../authorization/policies.js";
import type {
  CacheStore,
  Clock,
  Compressor,
  LogChunkRepository,
  LogStreamRepository,
  ObjectStore,
  PlatformMetrics,
  UsageRepository,
} from "../ports.js";

export interface QueryDeps {
  readonly clock: Clock;
  readonly streams: LogStreamRepository;
  readonly chunks: LogChunkRepository;
  readonly objects: ObjectStore;
  readonly compressor: Compressor;
  readonly cache: CacheStore;
  readonly usage: UsageRepository;
  readonly metrics: PlatformMetrics;
}

function decodeEntries(bytes: Uint8Array): LogEntry[] {
  const text = new TextDecoder().decode(bytes);
  const entries: LogEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line) {
      continue;
    }
    const parsed: unknown = JSON.parse(line);
    if (parsed && typeof parsed === "object" && "timestamp" in parsed && "line" in parsed) {
      const rec = parsed as LogEntry;
      entries.push({
        timestamp: rec.timestamp,
        line: rec.line,
        fields: rec.fields ?? {},
        traceId: rec.traceId ?? null,
        spanId: rec.spanId ?? null,
      });
    }
  }
  return entries;
}

export async function runLogQuery(
  deps: QueryDeps,
  principal: Principal,
  input: { query: string; start: number; end: number; limit?: number },
): Promise<QueryResult> {
  requirePermission(principal, "logs:read");
  const limits = DEFAULT_QUERY_LIMITS;
  if (input.query.length === 0 || input.query.length > limits.maxQueryLength) {
    throw new AppError(ErrorCodes.QUERY_INVALID, "Query length is outside allowed limits.", 400);
  }
  if (input.end <= input.start || input.end - input.start > limits.maxTimeRangeMs) {
    throw new AppError(
      ErrorCodes.QUERY_LIMIT_EXCEEDED,
      "Time range is outside allowed limits.",
      400,
    );
  }
  const started = deps.clock.now();
  const cacheKey = `q:${principal.tenantId}:${input.query}:${input.start}:${input.end}:${input.limit ?? ""}`;
  const cached = await deps.cache.get(cacheKey);
  if (cached) {
    deps.metrics.record("cache_hit", 1, { kind: "query" });
    return JSON.parse(cached) as QueryResult;
  }
  let ast;
  try {
    ast = parseQuery(input.query);
    validateSemantics(ast, limits);
  } catch (error) {
    if (error instanceof ParseError || error instanceof SemanticError) {
      throw new AppError(ErrorCodes.QUERY_INVALID, error.message, 400);
    }
    throw error;
  }
  const streams = await deps.streams.listByTenant(principal.tenantId, limits.maxStreams);
  const streamIds = streams.map((s) => s.id);
  const chunks = await deps.chunks.listInRange(
    principal.tenantId,
    streamIds,
    input.start,
    input.end,
  );
  if (chunks.length > limits.maxChunks) {
    throw new AppError(ErrorCodes.QUERY_LIMIT_EXCEEDED, "Query would scan too many chunks.", 400);
  }
  const plan = buildPlan(ast, streams, chunks, { start: input.start, end: input.end }, limits);
  const byStream = new Map<
    string,
    { labels: Readonly<Record<string, string>>; entries: LogEntry[] }
  >();
  for (const stream of streams) {
    if (plan.streamIds.includes(stream.id)) {
      byStream.set(stream.id, { labels: stream.labels.entries, entries: [] });
    }
  }
  for (const key of plan.chunkKeys) {
    if (deps.clock.now() - started > limits.maxDurationMs) {
      throw new AppError(
        ErrorCodes.QUERY_TIMEOUT,
        "Query execution exceeded the allowed limit.",
        408,
      );
    }
    const body = await deps.objects.get(key);
    if (!body) {
      continue;
    }
    const raw = await deps.compressor.gunzip(body);
    const entries = decodeEntries(raw);
    const streamId = chunks.find((c) => c.objectKey === key)?.streamId;
    if (!streamId) {
      continue;
    }
    const bucket = byStream.get(streamId);
    if (bucket) {
      bucket.entries.push(...entries);
    }
  }
  const maxRows = Math.min(input.limit ?? limits.maxResultRows, limits.maxResultRows);
  const result = executeEntries(plan, byStream, maxRows);
  await deps.cache.put(cacheKey, JSON.stringify(result), 15);
  await deps.usage.increment(principal.tenantId, hourPeriodStart(deps.clock.now()), {
    queryCount: 1,
    queryDurationMs: deps.clock.now() - started,
    apiRequests: 1,
  });
  deps.metrics.record("query_latency", deps.clock.now() - started, { kind: "logs" });
  return result;
}
