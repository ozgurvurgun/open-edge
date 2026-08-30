# ADR 0008: SSE for live tail

## Status

Accepted

## Context

Need reconnect, heartbeat, cancellation, backpressure.

## Decision

SSE over `GET /api/v1/logs/tail`, coordinated by per-tenant Durable Objects.

## Consequences

Proxies must not buffer SSE. WebSockets remain a future option behind the same hub messages.
