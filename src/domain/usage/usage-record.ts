import type { TenantId } from "../../shared/ids.js";

export interface UsageDelta {
  readonly ingestedBytes?: number;
  readonly ingestedEvents?: number;
  readonly storedBytes?: number;
  readonly queryCount?: number;
  readonly queryDurationMs?: number;
  readonly apiRequests?: number;
  readonly activeConnectionsPeak?: number;
}

export interface UsageRecord {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly periodStart: number;
  readonly ingestedBytes: number;
  readonly ingestedEvents: number;
  readonly storedBytes: number;
  readonly queryCount: number;
  readonly queryDurationMs: number;
  readonly apiRequests: number;
  readonly activeConnectionsPeak: number;
}

export function hourPeriodStart(timestamp: number): number {
  return Math.floor(timestamp / 3_600_000) * 3_600_000;
}
