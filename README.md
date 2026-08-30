# Open Edge

Cloudflare-native observability backend: logs, metrics, traces, APM, dashboards, and alerts.

The backend is a standalone versioned REST API (`/api/v1`). Any client may use it. Frontends never touch D1, R2, KV, Queues, or Durable Objects.

## Stack

TypeScript (strict), Hono, Cloudflare Workers, D1, R2, KV, Queues, Durable Objects, Cron.

## Quick start

Local loop: see [SETUP.md](SETUP.md) for a full greenfield Cloudflare install.

```bash
npm install
npm test
npm run typecheck
npx wrangler d1 migrations apply open-edge --local
npm run seed:owner -- --local --email 'dev@example.com' --password 'correct horse staple' --name Dev --tenant Dev
npm run dev
```

Sign in:

```bash
curl -X POST http://localhost:8787/api/v1/auth/login \
  -H 'content-type: application/json' \
  -H 'X-Open-Edge-CSRF: 1' \
  -d '{"email":"dev@example.com","password":"correct horse staple"}' \
  -c cookies.txt
```

Additional users are created by an admin via `POST /api/v1/users` (Administration UI). There is no public `/auth/register`.

## Documentation

| Doc                                        | Topic                           |
| ------------------------------------------ | ------------------------------- |
| [SETUP.md](SETUP.md)                       | From-scratch Cloudflare install |
| [ARCHITECTURE.md](ARCHITECTURE.md)         | System design                   |
| [BOUNDED_CONTEXTS.md](BOUNDED_CONTEXTS.md) | Context map                     |
| [API.md](API.md)                           | HTTP surface                    |
| [openapi.yaml](openapi.yaml)               | Contract                        |
| [AUTHENTICATION.md](AUTHENTICATION.md)     | Sessions and API keys           |
| [AUTHORIZATION.md](AUTHORIZATION.md)       | RBAC / permissions              |
| [QUERY_ENGINE.md](QUERY_ENGINE.md)         | LogQL-inspired engine           |
| [INGESTION.md](INGESTION.md)               | Async pipeline                  |
| [docs/DLQ.md](docs/DLQ.md)                 | Dead-letter runbook             |

ADRs live in [docs/adr/](docs/adr/).

## Deploy

Full steps (resources, migrations, UI build, seed): [SETUP.md](SETUP.md).

```bash
npx wrangler d1 migrations apply open-edge --remote
npx wrangler deploy
```

DLQ procedure: [docs/DLQ.md](docs/DLQ.md).
