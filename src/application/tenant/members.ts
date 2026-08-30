import { IdentityAuditActions } from "../../domain/identity/events.js";
import type { Role } from "../../domain/identity/permissions.js";
import { Roles } from "../../domain/identity/permissions.js";
import { validatePasswordPlaintext } from "../../domain/identity/password.js";
import { isValidEmail, normalizeEmail } from "../../domain/identity/user.js";
import { tenantAcceptsWrites, TenantAuditActions } from "../../domain/tenant/tenant.js";
import { AppError, ErrorCodes } from "../../shared/errors.js";
import { asUserId, type TenantId } from "../../shared/ids.js";
import { actorUserId, requirePermission, type Principal } from "../authorization/policies.js";
import type {
  ApiKeyRepository,
  AuditRepository,
  Clock,
  IdGenerator,
  MembershipRepository,
  PasswordHasher,
  SessionRepository,
  TenantRepository,
  UserRepository,
} from "../ports.js";

export interface TenantDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly users: UserRepository;
  readonly tenants: TenantRepository;
  readonly memberships: MembershipRepository;
  readonly sessions: SessionRepository;
  readonly apiKeys: ApiKeyRepository;
  readonly audit: AuditRepository;
  readonly passwords: PasswordHasher;
}

export async function getTenant(deps: TenantDeps, principal: Principal) {
  const tenant = await deps.tenants.findById(principal.tenantId);
  if (!tenant) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Tenant not found.", 404);
  }
  return tenant;
}

export async function listMembers(deps: TenantDeps, principal: Principal) {
  const memberships = await deps.memberships.listByTenant(principal.tenantId);
  const result = [];
  for (const m of memberships) {
    const user = await deps.users.findById(m.userId);
    if (user) {
      result.push({
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        role: m.role,
      });
    }
  }
  return result;
}

export async function inviteMember(
  deps: TenantDeps,
  principal: Principal,
  input: { email: string; displayName: string; role: Role; password: string },
) {
  requirePermission(principal, "members:write");
  if (!Roles.includes(input.role) || input.role === "owner") {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "Invalid role.", 400);
  }
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "A valid email is required.", 400);
  }
  const passwordError = validatePasswordPlaintext(input.password);
  if (passwordError) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, passwordError, 400);
  }
  const existing = await deps.users.findByEmail(email);
  if (existing) {
    throw new AppError(ErrorCodes.CONFLICT, "User already exists.", 409);
  }
  const now = deps.clock.now();
  const hashed = await deps.passwords.hash(input.password);
  const user = {
    id: asUserId(deps.ids.id()),
    email,
    displayName: input.displayName.trim(),
    passwordHash: hashed.hash,
    passwordSalt: hashed.salt,
    createdAt: now,
    updatedAt: now,
  };
  await deps.users.save(user);
  await deps.memberships.save({
    tenantId: principal.tenantId,
    userId: user.id,
    role: input.role,
    createdAt: now,
  });
  return { userId: user.id };
}

export async function changeRole(
  deps: TenantDeps,
  principal: Principal,
  userId: string,
  role: Role,
): Promise<void> {
  requirePermission(principal, "members:write");
  if (!Roles.includes(role)) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "Invalid role.", 400);
  }
  const membership = await deps.memberships.find(principal.tenantId, asUserId(userId));
  if (!membership) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Member not found.", 404);
  }
  if (membership.role === "owner" && role !== "owner") {
    const members = await deps.memberships.listByTenant(principal.tenantId);
    const owners = members.filter((m) => m.role === "owner");
    if (owners.length <= 1) {
      throw new AppError(
        ErrorCodes.VALIDATION_FAILED,
        "A tenant must keep at least one owner.",
        400,
      );
    }
  }
  await deps.memberships.save({ ...membership, role });
  await deps.audit.append({
    id: deps.ids.id(),
    tenantId: principal.tenantId,
    actorUserId: actorUserId(principal),
    action: IdentityAuditActions.ROLE_CHANGED,
    resourceType: "user",
    resourceId: userId,
    metadata: { role },
    ipHash: null,
    createdAt: deps.clock.now(),
  });
}

export async function removeMember(
  deps: TenantDeps,
  principal: Principal,
  userId: string,
): Promise<void> {
  requirePermission(principal, "members:write");
  const membership = await deps.memberships.find(principal.tenantId, asUserId(userId));
  if (!membership) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Member not found.", 404);
  }
  if (membership.role === "owner") {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "Cannot remove an owner.", 400);
  }
  await deps.memberships.delete(principal.tenantId, asUserId(userId));
}

export async function requestTenantDeletion(
  deps: TenantDeps,
  principal: Principal,
): Promise<TenantId> {
  requirePermission(principal, "tenant:admin");
  const tenant = await deps.tenants.findById(principal.tenantId);
  if (!tenant || !tenantAcceptsWrites(tenant)) {
    throw new AppError(ErrorCodes.TENANT_DISABLED, "Tenant is not available.", 403);
  }
  const now = deps.clock.now();
  await deps.tenants.save({ ...tenant, status: "deleting", updatedAt: now });
  await deps.sessions.revokeAllForTenant(tenant.id, now);
  await deps.apiKeys.revokeAllForTenant(tenant.id, now);
  await deps.audit.append({
    id: deps.ids.id(),
    tenantId: tenant.id,
    actorUserId: actorUserId(principal),
    action: TenantAuditActions.TENANT_DISABLED,
    resourceType: "tenant",
    resourceId: tenant.id,
    metadata: {},
    ipHash: null,
    createdAt: now,
  });
  return tenant.id;
}
