import {
  apiKeyHasPermission,
  type ApiKeyScope,
  type Permission,
  type Role,
  roleHasPermission,
} from "../../domain/identity/permissions.js";
import { AppError, ErrorCodes } from "../../shared/errors.js";
import type { ApiKeyId, SessionId, TenantId, UserId } from "../../shared/ids.js";

export type Principal =
  | {
      readonly kind: "session";
      readonly userId: UserId;
      readonly tenantId: TenantId;
      readonly sessionId: SessionId;
      readonly role: Role;
    }
  | {
      readonly kind: "apiKey";
      readonly tenantId: TenantId;
      readonly apiKeyId: ApiKeyId;
      readonly scopes: readonly ApiKeyScope[];
    };

export function hasPermission(principal: Principal, permission: Permission): boolean {
  if (principal.kind === "session") {
    return roleHasPermission(principal.role, permission);
  }
  return apiKeyHasPermission(principal.scopes, permission);
}

export function requirePermission(principal: Principal, permission: Permission): void {
  if (!hasPermission(principal, permission)) {
    throw new AppError(ErrorCodes.FORBIDDEN, "You are not allowed to perform this action.", 403);
  }
}

export function actorUserId(principal: Principal): UserId | null {
  return principal.kind === "session" ? principal.userId : null;
}
