# Retention

Retention is a first-class policy, not a side effect of storage.

Allowed values: 7, 30, 90, 180, 365 days, or custom 1-730 days. Independently configurable for logs, metrics, and traces.

```mermaid
flowchart TD
  Cron[Cron each minute] --> Sched[Retention scheduler]
  Sched --> Pol[Load policies]
  Sched --> Disc[Discover expired chunk/trace metadata via end_time index]
  Disc --> Job[Enqueue deletion job if none in-flight]
  Job --> Q[Deletion queue]
```

Discovery uses `idx_log_chunks_retention` / `idx_metric_chunks_retention` / `idx_traces_search`. It never lists the entire R2 bucket.

Default for a new tenant: 30 days for all three signals.
