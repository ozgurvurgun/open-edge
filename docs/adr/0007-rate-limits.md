# ADR 0007: Approximate vs strict rate limits

## Status

Accepted

## Context

KV cannot provide strict global atomic counters. Pretending otherwise is incorrect.

## Decision

- Approximate: Cloudflare Rate Limit bindings (IP / endpoint).
- Tenant volume: D1 usage counters updated in the consumer (operational, not billing).
- Query concurrency: short-lived KV lease, best-effort.

## Consequences

A burst can slightly exceed approximate limits. That is documented, not hidden.
