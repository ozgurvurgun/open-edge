# Realtime

Live log tail uses **SSE + per-tenant Durable Objects**.

| Option          | Verdict                                                                             |
| --------------- | ----------------------------------------------------------------------------------- |
| SSE             | Chosen. Simple reconnect, works through Workers `ReadableStream`, no extra protocol |
| WebSockets      | Viable but hibernation + proxy complexity is higher for log tail                    |
| Durable Objects | Required for fan-out and connection counts                                          |

## Sharding

Object name: `tenant:{tenantId}`. One DO per tenant, not one global hub. Tenants with very high fan-out can later shard by `tenant:{id}:{slot}` without API change.

## Connection rules

- Authenticated session or `logs:read` API key.
- Heartbeat comment every 15s.
- Client reconnects with `Last-Event-ID`.
- Max 10 connections per tenant (enforced in the DO).
- Backpressure: each subscriber has a 100-line buffer; overflow drops oldest and emits a `overflow` event.
- Cancellation: client abort or DO `close`.

SSE endpoint: `GET /api/v1/logs/tail`.
