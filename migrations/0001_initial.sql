-- Open Edge control-plane schema.
-- Telemetry bodies live in R2. D1 holds metadata, identity, and indexes only.

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'deleting', 'deleted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE tenant_memberships (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_memberships_user ON tenant_memberships(user_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER,
  rotated_from TEXT,
  user_agent TEXT,
  ip_hash TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_tenant ON sessions(tenant_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  scopes TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  last_used_at INTEGER,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id);

CREATE TABLE login_attempts (
  id TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  succeeded INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_login_attempts_email ON login_attempts(email_hash, created_at);
CREATE INDEX idx_login_attempts_ip ON login_attempts(ip_hash, created_at);

CREATE TABLE log_streams (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  labels_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE (tenant_id, fingerprint),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX idx_log_streams_tenant ON log_streams(tenant_id, last_seen_at);

CREATE TABLE log_chunks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  entry_count INTEGER NOT NULL,
  compressed_size INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  object_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'deleting', 'failed')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (stream_id) REFERENCES log_streams(id)
);

CREATE INDEX idx_log_chunks_lookup ON log_chunks(tenant_id, stream_id, start_time, end_time);
CREATE INDEX idx_log_chunks_status ON log_chunks(status, created_at);
CREATE INDEX idx_log_chunks_retention ON log_chunks(tenant_id, end_time);

CREATE TABLE ingestion_dedup (
  tenant_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, event_id)
);

CREATE INDEX idx_ingestion_dedup_created ON ingestion_dedup(created_at);

CREATE TABLE metric_series (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('counter', 'gauge', 'histogram')),
  labels_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE (tenant_id, fingerprint)
);

CREATE INDEX idx_metric_series_tenant ON metric_series(tenant_id, name);

CREATE TABLE metric_chunks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  series_id TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  sample_count INTEGER NOT NULL,
  compressed_size INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  object_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'deleting', 'failed')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (series_id) REFERENCES metric_series(id)
);

CREATE INDEX idx_metric_chunks_lookup ON metric_chunks(tenant_id, series_id, start_time, end_time);
CREATE INDEX idx_metric_chunks_retention ON metric_chunks(tenant_id, end_time);

CREATE TABLE traces (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  root_service TEXT NOT NULL,
  root_operation TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  span_count INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  object_key TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX idx_traces_search ON traces(tenant_id, start_time, duration_ms);
CREATE INDEX idx_traces_service ON traces(tenant_id, root_service, start_time);

CREATE TABLE spans_index (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  service TEXT NOT NULL,
  operation TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  UNIQUE (tenant_id, trace_id, span_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX idx_spans_trace ON spans_index(tenant_id, trace_id);
CREATE INDEX idx_spans_search ON spans_index(tenant_id, service, start_time);

CREATE TABLE dashboards (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  definition_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX idx_dashboards_tenant ON dashboards(tenant_id, updated_at);

CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('logs', 'metrics')),
  threshold REAL NOT NULL,
  comparator TEXT NOT NULL CHECK (comparator IN ('gt', 'gte', 'lt', 'lte')),
  window_seconds INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX idx_alerts_tenant ON alerts(tenant_id);

CREATE TABLE alert_states (
  alert_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'firing', 'pending')),
  last_evaluated_at INTEGER,
  last_fired_at INTEGER,
  last_value REAL,
  FOREIGN KEY (alert_id) REFERENCES alerts(id)
);

CREATE TABLE alert_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  alert_id TEXT NOT NULL,
  status TEXT NOT NULL,
  value REAL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_alert_events_alert ON alert_events(tenant_id, alert_id, created_at);

CREATE TABLE retention_policies (
  tenant_id TEXT PRIMARY KEY,
  logs_days INTEGER NOT NULL,
  metrics_days INTEGER NOT NULL,
  traces_days INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE deletion_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('retention', 'user_requested', 'tenant_deletion')),
  target TEXT NOT NULL CHECK (target IN ('logs', 'metrics', 'traces', 'all')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'scheduled', 'processing', 'completed', 'failed')),
  cursor TEXT,
  requested_by TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX idx_deletion_jobs_tenant ON deletion_jobs(tenant_id, created_at);
CREATE INDEX idx_deletion_jobs_status ON deletion_jobs(status, updated_at);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  ip_hash TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_audit_tenant ON audit_events(tenant_id, created_at);
CREATE INDEX idx_audit_action ON audit_events(action, created_at);

CREATE TABLE usage_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  ingested_bytes INTEGER NOT NULL DEFAULT 0,
  ingested_events INTEGER NOT NULL DEFAULT 0,
  stored_bytes INTEGER NOT NULL DEFAULT 0,
  query_count INTEGER NOT NULL DEFAULT 0,
  query_duration_ms INTEGER NOT NULL DEFAULT 0,
  api_requests INTEGER NOT NULL DEFAULT 0,
  active_connections_peak INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, period_start),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE apm_endpoint_stats (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  service TEXT NOT NULL,
  operation TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  duration_sum_ms INTEGER NOT NULL DEFAULT 0,
  duration_max_ms INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, service, operation, period_start)
);

CREATE INDEX idx_apm_stats ON apm_endpoint_stats(tenant_id, period_start);

CREATE TABLE saved_queries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('logs', 'metrics', 'traces')),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE platform_metrics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  value REAL NOT NULL,
  labels_json TEXT NOT NULL DEFAULT '{}',
  recorded_at INTEGER NOT NULL
);

CREATE INDEX idx_platform_metrics_name ON platform_metrics(name, recorded_at);
