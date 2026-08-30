import type { DashboardId, TenantId, UserId } from "../../shared/ids.js";

export interface DashboardWidget {
  readonly id: string;
  readonly title: string;
  readonly kind: "logs" | "metrics" | "traces";
  readonly query: string;
}

export interface DashboardDefinition {
  readonly widgets: readonly DashboardWidget[];
}

export interface Dashboard {
  readonly id: DashboardId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly description: string;
  readonly definition: DashboardDefinition;
  readonly createdBy: UserId;
  readonly createdAt: number;
  readonly updatedAt: number;
}
