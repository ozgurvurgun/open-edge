import type { TenantId, UserId } from "../../shared/ids.js";

export interface AuditEvent {
  readonly id: string;
  readonly tenantId: TenantId | null;
  readonly actorUserId: UserId | null;
  readonly action: string;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly metadata: Readonly<Record<string, string>>;
  readonly ipHash: string | null;
  readonly createdAt: number;
}
