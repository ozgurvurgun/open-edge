import type { TenantId } from "../../shared/ids.js";

export interface ServiceEdge {
  readonly tenantId: TenantId;
  readonly fromService: string;
  readonly toService: string;
  readonly periodStart: number;
  readonly callCount: number;
  readonly errorCount: number;
}
