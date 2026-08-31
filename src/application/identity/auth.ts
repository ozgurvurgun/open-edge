import { isApiKeyActive } from "../../domain/identity/api-key.js";
import { IdentityAuditActions } from "../../domain/identity/events.js";
import type { ApiKeyScope } from "../../domain/identity/permissions.js";
import { isApiKeyScope } from "../../domain/identity/permissions.js";
import { validatePasswordPlaintext } from "../../domain/identity/password.js";
import { isSessionActive } from "../../domain/identity/session.js";
import { isValidEmail, normalizeEmail, type User } from "../../domain/identity/user.js";
import { DEFAULT_RETENTION_DAYS } from "../../domain/retention/policy.js";
import { slugify, TenantAuditActions, type Tenant } from "../../domain/tenant/tenant.js";
import { AppError, ErrorCodes } from "../../shared/errors.js";
import {
  asApiKeyId,
  asSessionId,
  asTenantId,
  asUserId,
  type TenantId,
  type UserId,
} from "../../shared/ids.js";
import { requirePermission, type Principal } from "../authorization/policies.js";
import type {
  ApiKeyRepository,
  AuditRepository,
  CacheStore,
  Clock,
  IdGenerator,
  LoginAttemptRepository,
  MembershipRepository,
  PasswordHasher,
  RetentionRepository,
  SessionRepository,
  TenantRepository,
  TokenHasher,
  UserRepository,
} from "../ports.js";

const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const DUMMY_PASSWORD_HASH = "0".repeat(64);
const DUMMY_PASSWORD_SALT = "0".repeat(32);

export interface AuthDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly passwords: PasswordHasher;
  readonly tokens: TokenHasher;
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly tenants: TenantRepository;
  readonly memberships: MembershipRepository;
  readonly apiKeys: ApiKeyRepository;
  readonly attempts: LoginAttemptRepository;
  readonly audit: AuditRepository;
  readonly retention: RetentionRepository;
  readonly cache: CacheStore;
  readonly sessionTtlSeconds: number;
}

function emailHash(email: string): string {
  return `e:${normalizeEmail(email)}`;
}

async function writeAudit(
  deps: AuthDeps,
  action: string,
  tenantId: TenantId | null,
  userId: UserId | null,
  ipHash: string | null,
  metadata: Record<string, string> = {},
): Promise<void> {
  await deps.audit.append({
    id: deps.ids.id(),
    tenantId,
    actorUserId: userId,
    action,
    resourceType: null,
    resourceId: null,
    metadata,
    ipHash,
    createdAt: deps.clock.now(),
  });
}

export async function bootstrapTenant(
  deps: AuthDeps,
  input: { email: string; password: string; displayName: string; tenantName: string },
): Promise<{ userId: UserId; tenantId: TenantId }> {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "A valid email is required.", 400);
  }
  const passwordError = validatePasswordPlaintext(input.password);
  if (passwordError) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, passwordError, 400);
  }
  if (input.displayName.trim().length < 1 || input.tenantName.trim().length < 1) {
    throw new AppError(
      ErrorCodes.VALIDATION_FAILED,
      "Display name and tenant name are required.",
      400,
    );
  }
  if (await deps.users.findByEmail(email)) {
    throw new AppError(ErrorCodes.CONFLICT, "An account with this email already exists.", 409);
  }
  const now = deps.clock.now();
  const hashed = await deps.passwords.hash(input.password);
  const user: User = {
    id: asUserId(deps.ids.id()),
    email,
    displayName: input.displayName.trim(),
    passwordHash: hashed.hash,
    passwordSalt: hashed.salt,
    createdAt: now,
    updatedAt: now,
  };
  let slug = slugify(input.tenantName);
  if (await deps.tenants.findBySlug(slug)) {
    slug = `${slug}-${deps.ids.id().slice(0, 6)}`;
  }
  const tenant: Tenant = {
    id: asTenantId(deps.ids.id()),
    name: input.tenantName.trim(),
    slug,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  await deps.users.save(user);
  await deps.tenants.save(tenant);
  await deps.memberships.save({
    tenantId: tenant.id,
    userId: user.id,
    role: "owner",
    createdAt: now,
  });
  await deps.retention.save({
    tenantId: tenant.id,
    logsDays: DEFAULT_RETENTION_DAYS,
    metricsDays: DEFAULT_RETENTION_DAYS,
    tracesDays: DEFAULT_RETENTION_DAYS,
    updatedAt: now,
    updatedBy: user.id,
  });
  await writeAudit(deps, TenantAuditActions.TENANT_CREATED, tenant.id, user.id, null);
  return { userId: user.id, tenantId: tenant.id };
}

export async function login(
  deps: AuthDeps,
  input: { email: string; password: string; userAgent: string | null; ipHash: string | null },
): Promise<{ sessionId: string; token: string; expiresAt: number }> {
  const email = normalizeEmail(input.email);
  const now = deps.clock.now();
  const failures = await deps.attempts.countRecentFailures(
    emailHash(email),
    input.ipHash ?? "unknown",
    now - FAILURE_WINDOW_MS,
  );
  if (failures >= MAX_FAILURES) {
    throw new AppError(
      ErrorCodes.AUTH_RATE_LIMITED,
      "Too many failed login attempts. Try again later.",
      429,
    );
  }
  const user = await deps.users.findByEmail(email);
  // Always run PBKDF2 so missing emails are not cheaper than wrong passwords
  // (timing-based user enumeration). Dummy salt/hash never matches a real user.
  const valid = await deps.passwords.verify(
    input.password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    user?.passwordSalt ?? DUMMY_PASSWORD_SALT,
  );
  await deps.attempts.record(emailHash(email), input.ipHash ?? "unknown", valid, now);
  if (!user || !valid) {
    await writeAudit(deps, IdentityAuditActions.LOGIN_FAILED, null, user?.id ?? null, input.ipHash);
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, "Email or password is incorrect.", 401);
  }
  const memberships = await deps.memberships.listByUser(user.id);
  const membership = memberships[0];
  if (!membership) {
    throw new AppError(ErrorCodes.FORBIDDEN, "User is not a member of any tenant.", 403);
  }
  const tenant = await deps.tenants.findById(membership.tenantId);
  if (!tenant || tenant.status !== "active") {
    throw new AppError(ErrorCodes.TENANT_DISABLED, "Tenant is not available.", 403);
  }
  const token = deps.tokens.randomToken();
  const sessionId = asSessionId(deps.ids.id());
  await deps.sessions.save({
    id: sessionId,
    userId: user.id,
    tenantId: tenant.id,
    tokenHash: await deps.tokens.hash(token),
    createdAt: now,
    expiresAt: now + deps.sessionTtlSeconds * 1000,
    lastSeenAt: now,
    revokedAt: null,
    rotatedFrom: null,
    userAgent: input.userAgent,
    ipHash: input.ipHash,
  });
  await writeAudit(deps, IdentityAuditActions.LOGIN_SUCCESS, tenant.id, user.id, input.ipHash);
  return { sessionId, token, expiresAt: now + deps.sessionTtlSeconds * 1000 };
}

export async function logout(
  deps: AuthDeps,
  principal: Principal,
  tokenHash: string | null,
): Promise<void> {
  if (principal.kind !== "session") {
    return;
  }
  const session = await deps.sessions.findById(principal.sessionId);
  if (session && tokenHash) {
    await deps.sessions.save({ ...session, revokedAt: deps.clock.now() });
    await writeAudit(
      deps,
      IdentityAuditActions.SESSION_REVOKED,
      principal.tenantId,
      principal.userId,
      null,
      { sessionId: session.id },
    );
  }
}

export async function resolveSession(deps: AuthDeps, rawToken: string): Promise<Principal> {
  const session = await deps.sessions.findByTokenHash(await deps.tokens.hash(rawToken));
  if (!session || !isSessionActive(session, deps.clock.now())) {
    throw new AppError(ErrorCodes.UNAUTHENTICATED, "Session is missing or expired.", 401);
  }
  const membership = await deps.memberships.find(session.tenantId, session.userId);
  if (!membership) {
    throw new AppError(ErrorCodes.UNAUTHENTICATED, "Session is missing or expired.", 401);
  }
  const tenant = await deps.tenants.findById(session.tenantId);
  if (!tenant || tenant.status !== "active") {
    throw new AppError(ErrorCodes.TENANT_DISABLED, "Tenant is not available.", 403);
  }
  return {
    kind: "session",
    userId: session.userId,
    tenantId: session.tenantId,
    sessionId: session.id,
    role: membership.role,
  };
}

export async function resolveApiKey(deps: AuthDeps, rawKey: string): Promise<Principal> {
  const keyHash = await deps.tokens.hash(rawKey);
  const cached = await deps.cache.get(`apikey:${keyHash}`);
  let key = cached
    ? (JSON.parse(cached) as Awaited<ReturnType<ApiKeyRepository["findByHash"]>>)
    : null;
  if (!key) {
    key = await deps.apiKeys.findByHash(keyHash);
    if (key) {
      await deps.cache.put(`apikey:${keyHash}`, JSON.stringify(key), 60);
    }
  }
  if (!key || !isApiKeyActive(key, deps.clock.now())) {
    throw new AppError(ErrorCodes.UNAUTHENTICATED, "API key is invalid.", 401);
  }
  const tenant = await deps.tenants.findById(key.tenantId);
  if (!tenant || tenant.status !== "active") {
    throw new AppError(ErrorCodes.TENANT_DISABLED, "Tenant is not available.", 403);
  }
  await deps.apiKeys.save({ ...key, lastUsedAt: deps.clock.now() });
  return { kind: "apiKey", tenantId: key.tenantId, apiKeyId: key.id, scopes: key.scopes };
}

export async function changePassword(
  deps: AuthDeps,
  principal: Principal,
  current: string,
  next: string,
): Promise<void> {
  if (principal.kind !== "session") {
    throw new AppError(ErrorCodes.FORBIDDEN, "Password change requires a user session.", 403);
  }
  const passwordError = validatePasswordPlaintext(next);
  if (passwordError) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, passwordError, 400);
  }
  const user = await deps.users.findById(principal.userId);
  if (!user) {
    throw new AppError(ErrorCodes.NOT_FOUND, "User not found.", 404);
  }
  if (!(await deps.passwords.verify(current, user.passwordHash, user.passwordSalt))) {
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, "Current password is incorrect.", 401);
  }
  const hashed = await deps.passwords.hash(next);
  const now = deps.clock.now();
  await deps.users.save({
    ...user,
    passwordHash: hashed.hash,
    passwordSalt: hashed.salt,
    updatedAt: now,
  });
  await writeAudit(deps, IdentityAuditActions.PASSWORD_CHANGED, principal.tenantId, user.id, null);
}

export async function listSessions(deps: AuthDeps, principal: Principal) {
  if (principal.kind !== "session") {
    throw new AppError(ErrorCodes.FORBIDDEN, "Session listing requires a user session.", 403);
  }
  return deps.sessions.listByUser(principal.userId);
}

export async function revokeSession(
  deps: AuthDeps,
  principal: Principal,
  sessionId: string,
): Promise<void> {
  if (principal.kind !== "session") {
    throw new AppError(ErrorCodes.FORBIDDEN, "Session revoke requires a user session.", 403);
  }
  const session = await deps.sessions.findById(asSessionId(sessionId));
  if (!session || session.userId !== principal.userId) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Session not found.", 404);
  }
  await deps.sessions.save({ ...session, revokedAt: deps.clock.now() });
  await writeAudit(
    deps,
    IdentityAuditActions.SESSION_REVOKED,
    principal.tenantId,
    principal.userId,
    null,
    {
      sessionId,
    },
  );
}

export async function createApiKey(
  deps: AuthDeps,
  principal: Principal,
  input: { name: string; scopes: string[]; expiresAt: number | null },
): Promise<{ id: string; token: string; prefix: string }> {
  requirePermission(principal, "api-keys:write");
  if (principal.kind !== "session") {
    throw new AppError(ErrorCodes.FORBIDDEN, "API keys must be created by a user session.", 403);
  }
  const scopes: ApiKeyScope[] = [];
  for (const scope of input.scopes) {
    if (!isApiKeyScope(scope)) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, `Unknown scope: ${scope}`, 400);
    }
    scopes.push(scope);
  }
  if (scopes.length === 0) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, "At least one scope is required.", 400);
  }
  const raw = `oe_${deps.tokens.randomToken()}`;
  const now = deps.clock.now();
  const id = asApiKeyId(deps.ids.id());
  const keyHash = await deps.tokens.hash(raw);
  await deps.apiKeys.save({
    id,
    tenantId: principal.tenantId,
    name: input.name.trim(),
    keyHash,
    keyPrefix: raw.slice(0, 10),
    scopes,
    createdBy: principal.userId,
    createdAt: now,
    expiresAt: input.expiresAt,
    revokedAt: null,
    lastUsedAt: null,
  });
  await writeAudit(
    deps,
    IdentityAuditActions.API_KEY_CREATED,
    principal.tenantId,
    principal.userId,
    null,
    {
      apiKeyId: id,
    },
  );
  return { id, token: raw, prefix: raw.slice(0, 10) };
}

export async function listApiKeys(deps: AuthDeps, principal: Principal) {
  requirePermission(principal, "api-keys:write");
  const keys = await deps.apiKeys.listByTenant(principal.tenantId);
  return keys.map(({ keyHash: _h, ...rest }) => rest);
}

export async function revokeApiKey(
  deps: AuthDeps,
  principal: Principal,
  id: string,
): Promise<void> {
  requirePermission(principal, "api-keys:write");
  const key = await deps.apiKeys.findById(principal.tenantId, asApiKeyId(id));
  if (!key) {
    throw new AppError(ErrorCodes.NOT_FOUND, "API key not found.", 404);
  }
  await deps.apiKeys.save({ ...key, revokedAt: deps.clock.now() });
  await deps.cache.delete(`apikey:${key.keyHash}`);
  await writeAudit(
    deps,
    IdentityAuditActions.API_KEY_REVOKED,
    principal.tenantId,
    principal.kind === "session" ? principal.userId : null,
    null,
    { apiKeyId: id },
  );
}

export async function rotateApiKey(deps: AuthDeps, principal: Principal, id: string) {
  requirePermission(principal, "api-keys:write");
  const key = await deps.apiKeys.findById(principal.tenantId, asApiKeyId(id));
  if (!key) {
    throw new AppError(ErrorCodes.NOT_FOUND, "API key not found.", 404);
  }
  await deps.apiKeys.save({ ...key, revokedAt: deps.clock.now() });
  await deps.cache.delete(`apikey:${key.keyHash}`);
  return createApiKey(deps, principal, {
    name: key.name,
    scopes: [...key.scopes],
    expiresAt: key.expiresAt,
  });
}
