# Storage

## D1: control plane

D1 stores identity, indexes, and chunk metadata. Queries are tenant-scoped, indexed, and bounded. Prepared statements only.

Primary query patterns and matching indexes:

| Pattern                               | Index                                     |
| ------------------------------------- | ----------------------------------------- |
| Stream lookup by tenant + fingerprint | `UNIQUE (tenant_id, fingerprint)`         |
| Chunks in time range                  | `idx_log_chunks_lookup`                   |
| Expired chunks                        | `idx_log_chunks_retention`                |
| Trace search                          | `idx_traces_search`, `idx_traces_service` |
| Session by token hash                 | `sessions.token_hash UNIQUE`              |
| API key by hash                       | `api_keys.key_hash UNIQUE`                |

## R2: telemetry bodies

Object keys always start with the tenant id.

```text
t/{tenantId}/logs/{yyyy}/{mm}/{dd}/{streamId}/{chunkId}.ndjson.gz
t/{tenantId}/metrics/{yyyy}/{mm}/{dd}/{seriesId}/{chunkId}.bin.gz
t/{tenantId}/traces/{yyyy}/{mm}/{dd}/{traceId}.json.gz
```

This layout supports time pruning, prefix deletion, and tenant isolation. Keys are generated server-side. Client-supplied keys are rejected.

### Chunk strategy

| Signal  | Target compressed size | Time locality          | Why                                                                          |
| ------- | ---------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| Logs    | 256 KiB-1 MiB          | 1-5 minutes per stream | Enough entries for compression; small enough to scan a few objects per query |
| Metrics | 64-256 KiB             | 5 minutes per series   | Dense numeric samples                                                        |
| Traces  | One object per trace   | Trace lifetime         | Waterfall fetch is one R2 get                                                |

Do not create one R2 object per log line. Do not create multi-hour giant objects.

Write protocol: D1 `pending` → R2 put (deterministic key) → D1 `ready`. Reconciliation repairs leftovers.

## KV

| Key                      | TTL  | Consistency | Invalidation              | Staleness            |
| ------------------------ | ---- | ----------- | ------------------------- | -------------------- |
| `apikey:{hash}`          | 60s  | eventual    | revoke/rotate deletes key | 60s max after revoke |
| `tenant:{id}:flags`      | 120s | eventual    | tenant update/disable     | 120s                 |
| `q:{tenant}:{hash}`      | 15s  | eventual    | overwrite                 | 15s                  |
| `streamfp:{tenant}:{fp}` | 300s | eventual    | TTL                       | 5 min                |

KV is not used as a transactional store or a strict rate-limit counter.

## Cache API

Cache keys include: tenant id, authorization scope set, query text, time range, query version. Cross-tenant leakage is treated as a security defect.

## Analytics Engine

Optional future sink for platform self-metrics. Current self-metrics write bounded rows to `platform_metrics` to avoid recursive log ingestion.
