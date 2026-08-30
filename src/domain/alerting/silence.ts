import type { AlertId, TenantId, UserId } from "../../shared/ids.js";

export interface AlertSilence {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly alertId: AlertId | null;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly comment: string;
  readonly createdBy: UserId;
  readonly createdAt: number;
}

export function silenceIsActive(s: AlertSilence, now: number, alertId: AlertId): boolean {
  if (now < s.startsAt || now >= s.endsAt) return false;
  if (s.alertId === null) return true;
  return s.alertId === alertId;
}
