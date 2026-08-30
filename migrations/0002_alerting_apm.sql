-- Alert webhooks + pending hold; APM histograms + service map edges.

ALTER TABLE alerts ADD COLUMN webhook_url TEXT;
ALTER TABLE alerts ADD COLUMN for_seconds INTEGER NOT NULL DEFAULT 0;

ALTER TABLE apm_endpoint_stats ADD COLUMN duration_hist_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE apm_service_edges (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  from_service TEXT NOT NULL,
  to_service TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  call_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, from_service, to_service, period_start),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX idx_apm_edges ON apm_service_edges(tenant_id, period_start);
