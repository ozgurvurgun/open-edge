import type { SessionId, TenantId, UserId } from "../../shared/ids.js";

export interface Session {
  readonly id: SessionId;
  readonly userId: UserId;
  readonly tenantId: TenantId;
  readonly tokenHash: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly lastSeenAt: number;
  readonly revokedAt: number | null;
  readonly rotatedFrom: SessionId | null;
  readonly userAgent: string | null;
  readonly ipHash: string | null;
}

export function isSessionActive(session: Session, now: number): boolean {
  return session.revokedAt === null && session.expiresAt > now;
}
