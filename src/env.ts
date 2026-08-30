export interface Env {
  DB: D1Database;
  TELEMETRY: R2Bucket;
  KV: KVNamespace;
  INGEST_QUEUE: Queue;
  DELETION_QUEUE: Queue;
  REALTIME_HUB: DurableObjectNamespace;
  ALERT_COORDINATOR: DurableObjectNamespace;
  INGEST_BUFFER: DurableObjectNamespace;
  INGEST_RATE_LIMIT?: RateLimit;
  QUERY_RATE_LIMIT?: RateLimit;
  AUTH_RATE_LIMIT?: RateLimit;
  ENVIRONMENT: string;
  SESSION_TTL_SECONDS: string;
  SESSION_COOKIE_NAME: string;
  ALLOWED_ORIGINS: string;
  SESSION_SECRET?: string;
}

export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}
