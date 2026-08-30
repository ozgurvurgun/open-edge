# ADR 0002: D1 control plane, R2 telemetry bodies

## Status

Accepted

## Context

Storing each log line in D1 would exceed write, storage, and query budgets.

## Decision

D1 holds metadata and indexes. R2 holds compressed chunks. Query planning uses D1 to pick object keys.

## Consequences

Queries cannot do arbitrary SQL over log lines. Filtering happens after bounded R2 reads. This is the correct tradeoff on Cloudflare.
