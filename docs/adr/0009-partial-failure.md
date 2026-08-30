# ADR 0009: Partial failure and reconciliation

## Status

Accepted

## Context

No distributed transactions across R2 and D1.

## Decision

Pending metadata first, R2 put, ready mark. Cron re-drives pending > 2 minutes. Deletion marks `deleting` before R2 delete. Never delete D1 metadata before R2.

## Consequences

Orphan R2 objects are possible only if metadata write is skipped - the protocol forbids that path. Orphan pending rows are repaired.
