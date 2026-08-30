# Cost

| Decision       | Worker                         | D1                         | R2              | Queue               | KV                           | DO                    |
| -------------- | ------------------------------ | -------------------------- | --------------- | ------------------- | ---------------------------- | --------------------- |
| Async ingest   | 1 ingress + 1 consumer / batch | metadata only              | 1 put / chunk   | 1 publish / request | optional dedup               | notify if subscribers |
| Query          | 1                              | stream + chunk index reads | N gets, N ≤ 200 | 0                   | optional result cache        | 0                     |
| Tail           | 1 long-lived SSE               | 0 after auth               | 0               | 0                   | 0                            | 1 per tenant          |
| Retention cron | 1 / min                        | indexed discovery          | 0 until delete  | 1 / job page        | 0                            | 0                     |
| Delete page    | 1                              | 50 rows                    | 50 deletes      | retry               | prefix delete on tenant wipe | 0                     |

Avoided costs:

- No D1 row per log line (would explode writes and storage).
- No R2 list-all on query.
- No global Durable Object.
- KV not used as a write-ahead log.

Largest cost driver at scale is R2 Class A (ingest puts) and Class B (query gets). Chunking exists to keep object counts and get counts bounded.
