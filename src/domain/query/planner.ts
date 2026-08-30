import type { QueryAst, Selector } from "./ast.js";
import type { LabelSet } from "../logs/labels.js";
import { compileSafeRegex } from "./query-limits.js";
import type { QueryLimits } from "./query-limits.js";
import type { LogChunk, LogStream } from "../logs/log-stream.js";

export interface TimeRange {
  readonly start: number;
  readonly end: number;
}

export interface ExecutionPlan {
  readonly ast: QueryAst;
  readonly selector: Selector;
  readonly range: TimeRange;
  readonly streamIds: readonly string[];
  readonly chunkKeys: readonly string[];
  readonly aggregation: "none" | "count_over_time" | "rate";
  readonly stepMs: number;
}

export function streamMatchesSelector(stream: LogStream, selector: Selector): boolean {
  return selector.matchers.every((matcher) => {
    const actual = stream.labels.entries[matcher.name];
    if (actual === undefined) {
      return matcher.op === "!=" || matcher.op === "!~";
    }
    switch (matcher.op) {
      case "=":
        return actual === matcher.value;
      case "!=":
        return actual !== matcher.value;
      case "=~": {
        const re = compileSafeRegex(matcher.value);
        return re ? re.test(actual) : false;
      }
      case "!~": {
        const re = compileSafeRegex(matcher.value);
        return re ? !re.test(actual) : false;
      }
    }
  });
}

export function selectChunks(
  chunks: readonly LogChunk[],
  streamIds: ReadonlySet<string>,
  range: TimeRange,
  maxChunks: number,
): LogChunk[] {
  const selected = chunks
    .filter(
      (chunk) =>
        chunk.status === "ready" &&
        streamIds.has(chunk.streamId) &&
        chunk.endTime >= range.start &&
        chunk.startTime <= range.end,
    )
    .sort((a, b) => a.startTime - b.startTime);
  return selected.slice(0, maxChunks);
}

export function buildPlan(
  ast: QueryAst,
  streams: readonly LogStream[],
  chunks: readonly LogChunk[],
  range: TimeRange,
  limits: QueryLimits,
): ExecutionPlan {
  const selector = ast.type === "selector" ? ast : ast.selector;
  const matched = streams
    .filter((s) => streamMatchesSelector(s, selector))
    .slice(0, limits.maxStreams);
  const ids = new Set(matched.map((s) => s.id));
  const selectedChunks = selectChunks(chunks, ids, range, limits.maxChunks);
  return {
    ast,
    selector,
    range,
    streamIds: [...ids],
    chunkKeys: selectedChunks.map((c) => c.objectKey),
    aggregation: ast.type === "aggregation" ? ast.fn : "none",
    stepMs: ast.type === "aggregation" ? ast.range.milliseconds : 0,
  };
}

export function labelsOf(stream: { labels: LabelSet }): Readonly<Record<string, string>> {
  return stream.labels.entries;
}
