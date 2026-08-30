# Multi-tenancy

Isolation exists at authentication, authorization, application, repositories, D1, R2, KV, Cache, Queue payloads, realtime hubs, deletion, audit, usage, and query execution.

## Identity source

```text
session cookie → hashed lookup → (userId, tenantId, role)
API key       → hashed lookup → (tenantId, scopes)
```

`X-Tenant-ID` / `X-User-ID` / `X-Role` are discarded.

## Storage isolation

- D1: every tenant-owned query includes `WHERE tenant_id = ?`.
- R2: prefix `t/{tenantId}/`.
- KV: prefix includes tenant id.
- Cache API: tenant id in key.
- Queue messages carry `tenantId` from the authenticated principal, never from the client body as authority (body tenant fields are rejected).
- Realtime: Durable Object id = `tenant:{tenantId}`.

## Disabled / deleting tenants

Ingestion and queries return `TENANT_DISABLED`. Deletion workflow is resumable; see [DELETION.md](DELETION.md).
