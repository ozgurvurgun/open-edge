# Deletion

Mass deletion never runs inside a single HTTP request. HTTP creates a job.

## Job states

`pending` → `scheduled` → `processing` → `completed` | `failed`

Jobs are tenant-scoped, idempotent, resumable (cursor), retryable, and visible via API.

## Worker protocol

1. Load job, set `processing`.
2. Select next page of metadata (limit 50) after cursor.
3. For each object: mark D1 `deleting` → delete R2 → delete D1 row.
4. Persist cursor.
5. If page empty, `completed` + audit `DELETION_COMPLETED`.
6. On error, `failed` with a public error code; cron retries.

If R2 succeeds and D1 fails, retry deletes the already-gone R2 object (idempotent) then removes D1. If D1 is removed first, the object key would be lost - that order is forbidden.

## Tenant deletion

```text
Request → disable tenant → block ingest → revoke sessions
→ revoke API keys → delete R2 (prefix) via jobs → delete D1 rows
→ delete KV → invalidate caches → audit TENANT_DELETED
```

Resumable and idempotent. `deleted` tenants remain as a tombstone id to prevent reuse collisions.
