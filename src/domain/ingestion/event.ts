import type { EventId, TenantId } from "../../shared/ids.js";

export type TelemetryKind = "logs" | "metrics" | "traces";

export interface IngestionEvent {
  readonly eventId: EventId;
  readonly tenantId: TenantId;
  readonly kind: TelemetryKind;
  readonly receivedAt: number;
  readonly payload: unknown;
}

export function objectKeyPrefix(
  tenantId: TenantId,
  kind: TelemetryKind,
  timestamp: number,
): string {
  const date = new Date(timestamp);
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `t/${tenantId}/${kind}/${yyyy}/${mm}/${dd}`;
}

export function logObjectKey(
  tenantId: TenantId,
  streamId: string,
  chunkId: string,
  timestamp: number,
): string {
  return `${objectKeyPrefix(tenantId, "logs", timestamp)}/${streamId}/${chunkId}.ndjson.gz`;
}

export function metricObjectKey(
  tenantId: TenantId,
  seriesId: string,
  chunkId: string,
  timestamp: number,
): string {
  return `${objectKeyPrefix(tenantId, "metrics", timestamp)}/${seriesId}/${chunkId}.bin.gz`;
}

export function traceObjectKey(tenantId: TenantId, traceId: string, timestamp: number): string {
  return `${objectKeyPrefix(tenantId, "traces", timestamp)}/${traceId}.json.gz`;
}
