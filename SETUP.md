# Setup (from scratch)

This guide brings up Open Edge on a Cloudflare account with no prior resources. Keep the **backend** and **frontend** checkouts side by side (sibling directories). The Worker serves the UI from `../frontend/dist`.

```text
parent/
  open-edge/           # backend (this repo)
  open-edge-frontend/  # frontend
  open-edge-sdk/       # optional
  open-edge-example/   # optional
```

If you keep the monorepo layout (`backend/` + `frontend/` under one tree), paths below still work with `cd backend` / `cd frontend`.

## Prerequisites

- Node.js 20+
- Cloudflare account with Workers, D1, R2, KV, Queues enabled
- Logged in: `npx wrangler login`
- `git` clone of backend + frontend

## 1. Create Cloudflare resources

From the backend directory:

```bash
cd open-edge   # or backend/
npx wrangler d1 create open-edge
npx wrangler r2 bucket create open-edge-telemetry
npx wrangler kv namespace create open-edge-kv
npx wrangler queues create open-edge-ingest
npx wrangler queues create open-edge-ingest-dlq
npx wrangler queues create open-edge-deletion
npx wrangler queues create open-edge-deletion-dlq
```

Copy the printed **database_id** and **KV id** into `wrangler.toml`:

- `account_id` - Cloudflare dashboard → Workers → Account ID
- `[[d1_databases]].database_id`
- `[[kv_namespaces]].id` (and keep `binding = "KV"`)
- Bucket / queue **names** must match the create commands above (already set in toml)

Also set:

```toml
[vars]
ALLOWED_ORIGINS = "http://localhost:5173,https://<your-worker>.<subdomain>.workers.dev"
```

`[[ratelimits]]` `namespace_id` values (`1001`-`1003`) can stay as-is for a new account, or pick any unused integers unique in that account.

Durable Object classes (`RealtimeHub`, `AlertCoordinator`, `IngestBuffer`) are declared under `[[migrations]]`; the first deploy registers them. Do not renumber or delete past migration tags.

## 2. Apply D1 migrations

```bash
npx wrangler d1 migrations apply open-edge --remote
# local (optional):
npx wrangler d1 migrations apply open-edge --local
```

## 3. Build frontend assets

The Worker `[assets]` directory is `../frontend/dist` (sibling frontend checkout named `open-edge-frontend`, or monorepo `../frontend`).

```bash
cd ../open-edge-frontend   # or ../frontend
npm ci
# same-origin hosting: leave API base empty
VITE_API_BASE_URL= npm run build
```

Confirm `dist/index.html` exists before deploying the Worker.

## 4. Deploy the Worker

```bash
cd ../open-edge   # backend
npx wrangler deploy
```

Note the workers.dev URL. Update `ALLOWED_ORIGINS` if it changed, then redeploy.

Smoke:

```bash
curl -sS https://<worker-host>/health
curl -sS https://<worker-host>/ready
```

## 5. Seed the first owner

There is no public registration. Seed once:

```bash
node scripts/seed-owner.mjs --remote \
  --email 'owner@example.com' \
  --password 'choose-a-long-passphrase' \
  --name 'Ops Owner' \
  --tenant 'Acme'
```

Use `--local` instead of `--remote` for Miniflare D1. Password minimum: 12 characters.

Sign in at `https://<worker-host>/login` or:

```bash
curl -X POST https://<worker-host>/api/v1/auth/login \
  -H 'content-type: application/json' \
  -H 'X-Open-Edge-CSRF: 1' \
  -d '{"email":"owner@example.com","password":"choose-a-long-passphrase"}' \
  -c cookies.txt
```

Further users: Administration UI or `POST /api/v1/users` as owner/admin.

## 6. Create an ingest API key

In the UI: Settings → API keys → create with scopes you need (at least ingest). Or:

```bash
curl -X POST https://<worker-host>/api/v1/api-keys \
  -H 'content-type: application/json' \
  -H 'X-Open-Edge-CSRF: 1' \
  -b cookies.txt \
  -d '{"name":"ingest","scopes":["ingest:write","logs:write","metrics:write","traces:write"]}'
```

Store the returned `token` (`oe_...`) as a secret; it is shown once.

## 7. Optional: example Worker

```bash
cd ../open-edge-example
npm ci
# package.json: "@open-edge/sdk": "github:<org>/open-edge-sdk#main"  (or file:../sdk)
```

In `wrangler.toml`:

- set `account_id`
- set `OPEN_EDGE_BASE_URL` to the Open Edge workers URL (docs / health only)
- `[[services]]` `service = "open-edge"` must match the backend Worker **name**

```bash
npx wrangler secret put OPEN_EDGE_API_KEY   # paste oe_... token
npx wrangler deploy
```

Filter UI logs/metrics with `service="example-checkout"` (or your `SERVICE_NAME`).

## Local development

Backend (`wrangler.toml` `[vars]` is enough; no `.env` / `.dev.vars` required):

```bash
npx wrangler d1 migrations apply open-edge --local
node scripts/seed-owner.mjs --local --email 'dev@example.com' --password 'correct horse staple' --name Dev --tenant Dev
npm run dev
```

Frontend (optional: point Vite proxy at local Worker):

```bash
cd ../open-edge-frontend
VITE_DEV_PROXY=http://127.0.0.1:8787 npm run dev
```

## Checklist

| Step               | Done when                                             |
| ------------------ | ----------------------------------------------------- |
| Resources created  | D1 / R2 / KV / 4 queues exist; ids in `wrangler.toml` |
| Migrations         | `migrations apply --remote` succeeded                 |
| Frontend build     | `frontend/dist` present                               |
| Deploy             | `/health` and `/ready` OK                             |
| Owner seeded       | Login works                                           |
| API key            | Ingest token stored as secret                         |
| Example (optional) | Service binding + secret; traffic in UI               |

## Ops notes

- Run `wrangler deploy` deliberately; there is no automated deploy.
- UI + API: rebuild frontend, then deploy backend (assets upload with the Worker).
- DLQ: see [docs/DLQ.md](docs/DLQ.md).
- Do not commit API tokens or local secret files.
