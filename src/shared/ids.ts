export type Brand<T, B extends string> = T & { readonly __brand: B };

export type TenantId = Brand<string, "TenantId">;
export type UserId = Brand<string, "UserId">;
export type SessionId = Brand<string, "SessionId">;
export type ApiKeyId = Brand<string, "ApiKeyId">;
export type StreamId = Brand<string, "StreamId">;
export type ChunkId = Brand<string, "ChunkId">;
export type SeriesId = Brand<string, "SeriesId">;
export type TraceId = Brand<string, "TraceId">;
export type DashboardId = Brand<string, "DashboardId">;
export type AlertId = Brand<string, "AlertId">;
export type DeletionJobId = Brand<string, "DeletionJobId">;
export type EventId = Brand<string, "EventId">;

export function asTenantId(value: string): TenantId {
  return value as TenantId;
}
export function asUserId(value: string): UserId {
  return value as UserId;
}
export function asSessionId(value: string): SessionId {
  return value as SessionId;
}
export function asApiKeyId(value: string): ApiKeyId {
  return value as ApiKeyId;
}
export function asStreamId(value: string): StreamId {
  return value as StreamId;
}
export function asChunkId(value: string): ChunkId {
  return value as ChunkId;
}
export function asSeriesId(value: string): SeriesId {
  return value as SeriesId;
}
export function asTraceId(value: string): TraceId {
  return value as TraceId;
}
export function asDashboardId(value: string): DashboardId {
  return value as DashboardId;
}
export function asAlertId(value: string): AlertId {
  return value as AlertId;
}
export function asDeletionJobId(value: string): DeletionJobId {
  return value as DeletionJobId;
}
export function asEventId(value: string): EventId {
  return value as EventId;
}
