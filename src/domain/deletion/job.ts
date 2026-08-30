import type { DeletionJobId, TenantId, UserId } from "../../shared/ids.js";

export const DeletionKinds = ["retention", "user_requested", "tenant_deletion"] as const;
export type DeletionKind = (typeof DeletionKinds)[number];

export const DeletionTargets = ["logs", "metrics", "traces", "all"] as const;
export type DeletionTarget = (typeof DeletionTargets)[number];

export const DeletionStatuses = [
  "pending",
  "scheduled",
  "processing",
  "completed",
  "failed",
] as const;
export type DeletionStatus = (typeof DeletionStatuses)[number];

export interface DeletionJob {
  readonly id: DeletionJobId;
  readonly tenantId: TenantId;
  readonly kind: DeletionKind;
  readonly target: DeletionTarget;
  readonly status: DeletionStatus;
  readonly cursor: string | null;
  readonly requestedBy: UserId | null;
  readonly errorMessage: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly completedAt: number | null;
}

export const DeletionAuditActions = {
  DELETION_REQUESTED: "DELETION_REQUESTED",
  DELETION_COMPLETED: "DELETION_COMPLETED",
} as const;
