import type { TenantId, UserId } from "../../shared/ids.js";

export const PRESET_RETENTION_DAYS = [7, 30, 90, 180, 365] as const;
export const MIN_CUSTOM_DAYS = 1;
export const MAX_CUSTOM_DAYS = 730;
export const DEFAULT_RETENTION_DAYS = 30;

export interface RetentionPolicy {
  readonly tenantId: TenantId;
  readonly logsDays: number;
  readonly metricsDays: number;
  readonly tracesDays: number;
  readonly updatedAt: number;
  readonly updatedBy: UserId;
}

export function isValidRetentionDays(days: number): boolean {
  if (!Number.isInteger(days)) {
    return false;
  }
  if ((PRESET_RETENTION_DAYS as readonly number[]).includes(days)) {
    return true;
  }
  return days >= MIN_CUSTOM_DAYS && days <= MAX_CUSTOM_DAYS;
}

export const RetentionAuditActions = {
  RETENTION_CHANGED: "RETENTION_CHANGED",
} as const;
