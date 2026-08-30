import type { TenantId, TraceId } from "../../shared/ids.js";

export const SpanStatuses = ["ok", "error"] as const;
export type SpanStatus = (typeof SpanStatuses)[number];

export interface SpanEvent {
  readonly timestamp: number;
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
}

export interface Span {
  readonly traceId: TraceId;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly service: string;
  readonly operation: string;
  readonly startTime: number;
  readonly durationMs: number;
  readonly status: SpanStatus;
  readonly attributes: Readonly<Record<string, string>>;
  readonly events: readonly SpanEvent[];
}

export interface Trace {
  readonly id: TraceId;
  readonly tenantId: TenantId;
  readonly rootService: string;
  readonly rootOperation: string;
  readonly startTime: number;
  readonly durationMs: number;
  readonly spanCount: number;
  readonly status: SpanStatus;
  readonly objectKey: string | null;
  readonly createdAt: number;
}

export function rootSpan(spans: readonly Span[]): Span | null {
  return spans.find((s) => s.parentSpanId === null) ?? spans[0] ?? null;
}

export function traceStatus(spans: readonly Span[]): SpanStatus {
  return spans.some((s) => s.status === "error") ? "error" : "ok";
}
