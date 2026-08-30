# API

Base path: `/api/v1`. Machine-readable contract: [openapi.yaml](openapi.yaml).

Envelope:

```json
{ "data": {}, "error": null }
```

Errors:

```json
{
  "data": null,
  "error": { "code": "QUERY_TIMEOUT", "message": "Query execution exceeded the allowed limit." }
}
```

## Endpoints

| Method | Path                      | Auth                 |
| ------ | ------------------------- | -------------------- |
| POST   | `/auth/login`             | public               |
| POST   | `/auth/logout`            | session              |
| GET    | `/auth/session`           | session              |
| POST   | `/auth/change-password`   | session              |
| GET    | `/auth/sessions`          | session              |
| DELETE | `/auth/sessions/:id`      | session              |
| GET    | `/users/me`               | session              |
| PATCH  | `/users/me`               | session              |
| GET    | `/users`                  | session              |
| POST   | `/users`                  | session admin        |
| PATCH  | `/users/:id/role`         | session admin        |
| DELETE | `/users/:id`              | session admin        |
| GET    | `/tenant`                 | session              |
| POST   | `/tenant/deletion`        | owner                |
| GET    | `/api-keys`               | session              |
| POST   | `/api-keys`               | session admin        |
| DELETE | `/api-keys/:id`           | session admin        |
| POST   | `/api-keys/:id/rotate`    | session admin        |
| GET    | `/log-streams`            | read logs            |
| GET    | `/log-streams/:id`        | read logs            |
| POST   | `/v1/logs` (OTLP JSON)    | write logs           |
| POST   | `/v1/traces` (OTLP JSON)  | write traces         |
| POST   | `/v1/metrics` (OTLP JSON) | write metrics        |
| POST   | `/logs/ingest`            | write logs           |
| POST   | `/logs/query`             | read logs            |
| GET    | `/logs/tail`              | read logs (SSE)      |
| POST   | `/metrics/ingest`         | write metrics        |
| POST   | `/metrics/query`          | read metrics         |
| GET    | `/metrics`                | read metrics         |
| POST   | `/traces/ingest`          | write traces         |
| GET    | `/traces`                 | read traces          |
| GET    | `/traces/:traceId`        | read traces          |
| GET    | `/dashboards`             | read dashboards      |
| POST   | `/dashboards`             | write dashboards     |
| GET    | `/dashboards/:id`         | read dashboards      |
| PUT    | `/dashboards/:id`         | write dashboards     |
| DELETE | `/dashboards/:id`         | write dashboards     |
| GET    | `/alerts`                 | read alerts          |
| POST   | `/alerts`                 | write alerts         |
| GET    | `/alerts/:id`             | read alerts          |
| GET    | `/alerts/:id/state`       | read alerts          |
| GET    | `/alerts/:id/events`      | read alerts          |
| PUT    | `/alerts/:id`             | write alerts         |
| DELETE | `/alerts/:id`             | write alerts         |
| GET    | `/retention`              | session              |
| PUT    | `/retention`              | admin                |
| POST   | `/data-deletion`          | admin                |
| GET    | `/data-deletion`          | admin                |
| GET    | `/data-deletion/:id`      | admin                |
| GET    | `/apm/overview`           | read traces          |
| GET    | `/apm/services`           | read traces          |
| GET    | `/apm/endpoints`          | read traces          |
| GET    | `/apm/service-map`        | read traces          |
| GET    | `/usage`                  | session              |
| GET    | `/audit`                  | admin                |
| GET    | `/health`                 | public (unversioned) |
| GET    | `/ready`                  | public (unversioned) |

Pagination: `limit` (max 100) + `cursor`. Rate-limit headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining` when a binding is configured.
