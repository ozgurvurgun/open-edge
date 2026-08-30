# Domain model

## Identity

- **User**: email (unique login identifier), password hash+salt, display name.
- **Session**: hashed token, tenant binding, expiry, optional rotation parent, revoke timestamp.
- **ApiKey**: hashed secret, prefix for display, scopes, expiry, last used.
- **PasswordPolicy**: minimum length 12, reject empty/whitespace-only, never store plaintext.

Invariants: one email per user; sessions belong to exactly one tenant; revoked or expired sessions cannot authenticate.

## Tenant

- **Tenant**: name, slug, status (`active` \| `disabled` \| `deleting` \| `deleted`).
- **Membership**: user + role (`owner` \| `admin` \| `editor` \| `viewer`).

Invariants: disabled tenants reject ingestion and queries; deleting tenants reject all writes; at least one owner while tenant is active.

## Logs

- **LabelSet**: low-cardinality key/value map. Forbidden stream labels: `user_id`, `request_id`, `trace_id`, `session_id` (those stay on the entry).
- **LogStream**: tenant + fingerprint(labels).
- **LogEntry**: timestamp, line, optional structured fields, optional `traceId`/`spanId`.
- **LogChunk**: time range, entry count, compressed size, checksum, object key, status.

Cardinality policy: max 20 labels per stream, key ≤ 64 chars, value ≤ 256 chars, max 10_000 streams per tenant.

## Metrics

- **Metric**: name + type (`counter` \| `gauge` \| `histogram`).
- **MetricSeries**: metric + LabelSet + fingerprint.
- **MetricSample**: timestamp + value, or histogram buckets + count + sum.

Cardinality: max 15 labels, max 20_000 series per tenant.

## Tracing

- **Trace**: traceId, root service/operation, start, duration, span count, status.
- **Span**: spanId, parent, service, operation, start, duration, status, attributes, events.

## Query

Untrusted input. AST is the only executable form. Limits are domain policy, not handler checks.

## Retention / deletion

- **RetentionPolicy**: days for logs, metrics, traces (7, 30, 90, 180, 365, or custom 1-730).
- **DeletionJob**: kind, target, status (`pending` \| `scheduled` \| `processing` \| `completed` \| `failed`), cursor, error.

Jobs are idempotent and resumable via cursor.

## Authorization

Roles expand to permissions. Default is deny. See [AUTHORIZATION.md](AUTHORIZATION.md).
