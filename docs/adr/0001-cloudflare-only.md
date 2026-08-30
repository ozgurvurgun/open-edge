# ADR 0001: Cloudflare-only infrastructure

## Status

Accepted

## Context

The product must run as a serious observability backend without introducing PostgreSQL, Redis, Kafka, or a second cloud.

## Decision

Use Workers, D1, R2, KV, Queues, Durable Objects, Cache API, and Cron only.

## Consequences

We accept Worker CPU/time limits, D1 SQLite semantics, KV eventual consistency, and at-least-once queues. Query and ingest designs are built around those limits rather than emulating a TSDB cluster.
