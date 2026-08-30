import type { ApiKeyScope } from "./permissions.js";
import type { ApiKeyId, TenantId, UserId } from "../../shared/ids.js";

export interface ApiKey {
  readonly id: ApiKeyId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly keyHash: string;
  readonly keyPrefix: string;
  readonly scopes: readonly ApiKeyScope[];
  readonly createdBy: UserId;
  readonly createdAt: number;
  readonly expiresAt: number | null;
  readonly revokedAt: number | null;
  readonly lastUsedAt: number | null;
}

export function isApiKeyActive(key: ApiKey, now: number): boolean {
  if (key.revokedAt !== null) {
    return false;
  }
  if (key.expiresAt !== null && key.expiresAt <= now) {
    return false;
  }
  return true;
}

export function publicApiKeyView(key: ApiKey): Omit<ApiKey, "keyHash"> {
  const { keyHash: _hash, ...rest } = key;
  return rest;
}
