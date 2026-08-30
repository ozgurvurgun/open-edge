import type { LabelSet } from "../logs/labels.js";
import type { SeriesId, TenantId } from "../../shared/ids.js";
import type { ChunkStatus } from "../logs/log-stream.js";

export const MetricTypes = ["counter", "gauge", "histogram"] as const;
export type MetricType = (typeof MetricTypes)[number];

export const MAX_METRIC_LABELS = 15;
export const MAX_SERIES_PER_TENANT = 20_000;

export interface MetricSeries {
  readonly id: SeriesId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly type: MetricType;
  readonly labels: LabelSet;
  readonly fingerprint: string;
  readonly createdAt: number;
  readonly lastSeenAt: number;
}

export interface MetricSample {
  readonly timestamp: number;
  readonly value: number;
  readonly buckets?: Readonly<Record<string, number>>;
  readonly count?: number;
  readonly sum?: number;
}

export interface MetricChunk {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly seriesId: SeriesId;
  readonly startTime: number;
  readonly endTime: number;
  readonly sampleCount: number;
  readonly compressedSize: number;
  readonly checksum: string;
  readonly objectKey: string;
  readonly status: ChunkStatus;
  readonly createdAt: number;
}

export function isValidMetricName(name: string): boolean {
  return /^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name) && name.length <= 128;
}
