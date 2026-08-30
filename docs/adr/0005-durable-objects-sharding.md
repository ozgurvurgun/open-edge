# ADR 0005: Durable Object sharding

## Status

Accepted

## Context

Realtime fan-out and alert locks need coordination. A single global DO would hot-shard the platform.

## Decision

`RealtimeHub` and `AlertCoordinator` IDs are `tenant:{tenantId}`. No global object.

## Consequences

Per-tenant connection limits are local to that object. Cross-tenant realtime is impossible by construction.
