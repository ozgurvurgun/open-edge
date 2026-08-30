import type { Role } from "../identity/permissions.js";
import type { TenantId, UserId } from "../../shared/ids.js";

export const TenantStatuses = ["active", "disabled", "deleting", "deleted"] as const;
export type TenantStatus = (typeof TenantStatuses)[number];

export interface Tenant {
  readonly id: TenantId;
  readonly name: string;
  readonly slug: string;
  readonly status: TenantStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface Membership {
  readonly tenantId: TenantId;
  readonly userId: UserId;
  readonly role: Role;
  readonly createdAt: number;
}

export function tenantAcceptsWrites(tenant: Tenant): boolean {
  return tenant.status === "active";
}

export function tenantAcceptsReads(tenant: Tenant): boolean {
  return tenant.status === "active";
}

export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length > 0 ? slug : "tenant";
}

export const TenantAuditActions = {
  TENANT_CREATED: "TENANT_CREATED",
  TENANT_DISABLED: "TENANT_DISABLED",
  TENANT_DELETED: "TENANT_DELETED",
} as const;
