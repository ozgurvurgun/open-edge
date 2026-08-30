-- Alert silences (mute windows) + ingest buffer is DO-backed (no extra tables).

CREATE TABLE alert_silences (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  alert_id TEXT,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (alert_id) REFERENCES alerts(id)
);

CREATE INDEX idx_alert_silences_tenant ON alert_silences(tenant_id, ends_at);
CREATE INDEX idx_alert_silences_alert ON alert_silences(tenant_id, alert_id, ends_at);
