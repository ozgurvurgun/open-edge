import type { AlertId, TenantId, UserId } from "../../shared/ids.js";

export const AlertComparators = ["gt", "gte", "lt", "lte"] as const;
export type AlertComparator = (typeof AlertComparators)[number];

export const AlertKinds = ["logs", "metrics"] as const;
export type AlertKind = (typeof AlertKinds)[number];

export const AlertStateStatuses = ["ok", "firing", "pending"] as const;
export type AlertStateStatus = (typeof AlertStateStatuses)[number];

export interface Alert {
  readonly id: AlertId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly query: string;
  readonly kind: AlertKind;
  readonly threshold: number;
  readonly comparator: AlertComparator;
  readonly windowSeconds: number;
  readonly forSeconds: number;
  readonly webhookUrl: string | null;
  readonly enabled: boolean;
  readonly createdBy: UserId;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface AlertEvent {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly alertId: AlertId;
  readonly status: AlertStateStatus;
  readonly value: number | null;
  readonly createdAt: number;
}

export interface AlertState {
  readonly alertId: AlertId;
  readonly tenantId: TenantId;
  readonly status: AlertStateStatus;
  readonly lastEvaluatedAt: number | null;
  readonly lastFiredAt: number | null;
  readonly lastValue: number | null;
}

export function compareThreshold(
  value: number,
  comparator: AlertComparator,
  threshold: number,
): boolean {
  switch (comparator) {
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
  }
}
