# ADR 0003: At-least-once ingestion

## Status

Accepted

## Context

Queues retry. Exactly-once is not available.

## Decision

Require `eventId`, persist dedup rows, use deterministic chunk keys, and a pending→ready metadata protocol.

## Consequences

Duplicates are suppressed, not assumed absent. Consumers must be idempotent. Reconciliation repairs crashes.
