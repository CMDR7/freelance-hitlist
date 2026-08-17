# FL-HL // Intelligence API

V2.4 introduces the lightweight backend boundary for the Freelancer // Intelligence Network.

## Purpose

The browser UI will eventually consume one normalized API instead of calling external job sources directly.

```text
FL-HL CLIENT
     |
     v
INTELLIGENCE API
     |
     +--> D1 / cache
     +--> RSS / Atom feeds
     +--> publication feeds
     +--> approved free APIs
```

## Current V2.4 state

The Worker is a **safe backend scaffold**. It does not ingest external feeds yet and it does not expose secrets to the browser.

Available routes:

- `GET /api`
- `GET /api/health`
- `GET /api/sources`
- `GET /api/opportunities`
- `GET /api/sync/status`

The source and opportunity endpoints currently return empty normalized collections. This is intentional. Live ingestion begins in V2.5.

## Planned storage

Cloudflare D1 is the intended relational store because the project needs relationships between sources, feeds, opportunities, and discovery records. D1 is available on the Workers Free plan and currently includes 5 GB storage, 5 million rows read/day, and 100,000 rows written/day. These limits are sufficient for the initial prototype. See the official Cloudflare documentation before deployment because platform limits and pricing can change.

## Deployment

The Worker can be deployed separately from GitHub Pages using Wrangler:

```bash
cd backend
wrangler deploy
```

Cloudflare authentication, the Worker deployment, and creation of the eventual D1 database are intentionally **not** automated from this repository. Those are infrastructure/account operations and should be performed only after the backend scaffold is reviewed.

## Security rules

- No API keys belong in `index.html`.
- No secrets are committed to Git.
- External source credentials will be stored as Worker secrets when required.
- Browser requests will use the normalized API boundary.
- Unknown sources remain discovery records until human approval.
