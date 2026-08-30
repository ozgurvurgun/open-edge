# Caching

## KV

See [STORAGE.md](STORAGE.md) for TTL, consistency, invalidation, and acceptable staleness per key class.

## Cache API

Used for successful log/metric query responses under 256 KiB.

Key material (all required):

```text
v1 | tenantId | sorted(scopes) | query | start | end | limit
```

`Cache-Control: private, max-age=15`. Never cache errors, auth failures, or tenant-disabled responses.

Invalidation is TTL-based. Revoking a key does not need to purge Cache API because scope is in the key and the next request fails auth before cache lookup.
