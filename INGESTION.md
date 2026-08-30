# Ingestion

```mermaid
flowchart TD
  Client --> Ingress[Ingress Worker]
  Ingress --> Auth[Authn session or API key]
  Ingress --> Authz[Scope check]
  Ingress --> Val[Validate + normalize]
  Ingress --> Q[Ingest Queue]
  Q --> Cons[Consumer]
  Cons --> Dedup[eventId dedup]
  Cons --> Batch[Group by stream/series]
  Cons --> Chunk[Compress chunk]
  Cons --> D1p[D1 pending metadata]
  Cons --> R2[R2 put]
  Cons --> D1r[D1 ready]
  Cons --> RT[Realtime hub]
  Cons --> Usage[Usage counters]
```

Ingress never writes raw telemetry rows to D1.

## Event contract

Every event has `eventId` (client or server assigned UUID). Repeated Queue delivery hits `ingestion_dedup` and is dropped.

## Normalization

- Timestamps coerced to Unix milliseconds.
- Labels trimmed, lowercased keys, high-cardinality names rejected as stream identity.
- Line size capped at 16 KiB.
- Batch size capped at 500 events / 512 KiB.

## Queue semantics

At-least-once. Consumer retries use Queue retries (max 5) then DLQ `open-edge-ingest-dlq`. Partial batch: successful events are recorded in dedup so retries skip them. Poison messages after max retries land in the DLQ; they are not silently dropped.

## Idempotency

Deterministic chunk ids are derived from `tenantId + sorted eventIds`. Re-putting the same R2 key is safe.

## Realtime

After a chunk is `ready`, a compact notification is sent to the tenant-sharded Durable Object. The hub fans out matching lines to SSE subscribers with backpressure (drop-oldest per connection).
