import type { TenantId } from "../../shared/ids.js";
import type { LatencyHist } from "./histogram.js";

export interface EndpointStats {
  readonly tenantId: TenantId;
  readonly service: string;
  readonly operation: string;
  readonly periodStart: number;
  readonly requestCount: number;
  readonly errorCount: number;
  readonly durationSumMs: number;
  readonly durationMaxMs: number;
  readonly durationHist?: LatencyHist;
}

export function errorRate(stats: EndpointStats): number {
  if (stats.requestCount === 0) {
    return 0;
  }
  return stats.errorCount / stats.requestCount;
}

export function averageLatency(stats: EndpointStats): number {
  if (stats.requestCount === 0) {
    return 0;
  }
  return stats.durationSumMs / stats.requestCount;
}
