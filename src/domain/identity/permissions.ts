export const Roles = ["owner", "admin", "editor", "viewer"] as const;
export type Role = (typeof Roles)[number];

export const Permissions = [
  "logs:read",
  "logs:write",
  "metrics:read",
  "metrics:write",
  "traces:read",
  "traces:write",
  "dashboards:read",
  "dashboards:write",
  "alerts:read",
  "alerts:write",
  "api-keys:write",
  "retention:write",
  "deletion:write",
  "members:write",
  "audit:read",
  "usage:read",
  "tenant:admin",
  "admin",
] as const;

export type Permission = (typeof Permissions)[number];

const VIEWER: Permission[] = [
  "logs:read",
  "metrics:read",
  "traces:read",
  "dashboards:read",
  "alerts:read",
  "usage:read",
];

const EDITOR: Permission[] = [
  ...VIEWER,
  "logs:write",
  "metrics:write",
  "traces:write",
  "dashboards:write",
  "alerts:write",
];

const ADMIN: Permission[] = [
  ...EDITOR,
  "api-keys:write",
  "retention:write",
  "deletion:write",
  "members:write",
  "audit:read",
];

const OWNER: Permission[] = [...ADMIN, "tenant:admin"];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  viewer: VIEWER,
  editor: EDITOR,
  admin: ADMIN,
  owner: OWNER,
};

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export const ApiKeyScopes = [
  "logs:write",
  "logs:read",
  "metrics:write",
  "metrics:read",
  "traces:write",
  "traces:read",
  "dashboards:read",
  "dashboards:write",
  "alerts:read",
  "alerts:write",
  "admin",
] as const;

export type ApiKeyScope = (typeof ApiKeyScopes)[number];

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return (ApiKeyScopes as readonly string[]).includes(value);
}

export function apiKeyHasPermission(
  scopes: readonly ApiKeyScope[],
  permission: Permission,
): boolean {
  if (scopes.includes("admin")) {
    return permission !== "tenant:admin";
  }
  return (scopes as readonly string[]).includes(permission);
}
