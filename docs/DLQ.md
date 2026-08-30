# Dead-letter queues

Poison or exhausted ingest/deletion messages land here after Queue retries.

| Queue                | Role                      | After retries            |
| -------------------- | ------------------------- | ------------------------ |
| `open-edge-ingest`   | Telemetry ingest          | `open-edge-ingest-dlq`   |
| `open-edge-deletion` | Retention / user deletion | `open-edge-deletion-dlq` |

## Inspect

```bash
npx wrangler queues consumer http add open-edge-ingest-dlq --help
npx wrangler queues list
```

Dashboard: Cloudflare → Queues → `open-edge-ingest-dlq` / `open-edge-deletion-dlq`.

## Operator steps

1. Open the DLQ in the dashboard and read a sample payload. Payloads contain `tenantId`, `kind`, `eventId` - never secrets.
2. Decide: discard (malformed / adversarial) or fix code and **replay** by sending the same `eventId` back to `open-edge-ingest` (dedup is safe).
3. Deletion DLQ: inspect `jobId`, then `GET /api/v1/data-deletion/:id` for job status. Re-queue with `wrangler queues producer` or wait for the next cron (`listProcessable` re-enqueues failed jobs).
4. After replay, purge processed DLQ messages so the same poison item is not counted twice.

Do not attach an automatic consumer to a DLQ that writes back into the primary queue without a human gate.
