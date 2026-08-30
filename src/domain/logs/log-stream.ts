import type { LabelSet } from "./labels.js";
import type { StreamId, TenantId } from "../../shared/ids.js";

export interface LogStream {
  readonly id: StreamId;
  readonly tenantId: TenantId;
  readonly fingerprint: string;
  readonly labels: LabelSet;
  readonly createdAt: number;
  readonly lastSeenAt: number;
}

export const ChunkStatuses = ["pending", "ready", "deleting", "failed"] as const;
export type ChunkStatus = (typeof ChunkStatuses)[number];

export interface LogChunk {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly streamId: StreamId;
  readonly startTime: number;
  readonly endTime: number;
  readonly entryCount: number;
  readonly compressedSize: number;
  readonly checksum: string;
  readonly objectKey: string;
  readonly status: ChunkStatus;
  readonly createdAt: number;
}

export interface LogEntry {
  readonly timestamp: number;
  readonly line: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly traceId: string | null;
  readonly spanId: string | null;
}

export const MAX_LINE_LENGTH = 16 * 1024;
export const MAX_INGEST_EVENTS = 500;
export const MAX_INGEST_BYTES = 512 * 1024;
export const TARGET_CHUNK_COMPRESSED_MIN = 256 * 1024;
export const TARGET_CHUNK_COMPRESSED_MAX = 1024 * 1024;
