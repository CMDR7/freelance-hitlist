# FL-HL // Intelligence API

V2.5 introduces the first live acquisition layer for the Freelancer // Intelligence Network.

## Purpose

The browser UI will eventually consume one normalized API instead of calling external job sources directly.

```text
FL-HL CLIENT
     |
     v
INTELLIGENCE API
     |
     +--> D1 / cache
     +--> RSS / Atom feeds       <-- V2.5
     +--> publication feeds
     +--> approved free APIs     <-- V2.6
```

## Current V2.5 state

The Worker can now fetch a controlled registry of public RSS feeds and expose the resulting listings as **ingested candidates**.

Configured public feeds currently include:

- Remote First Jobs // AI
- Jobicy // AI Remote Jobs
- RemoteYeah // remote engineering feed
- We Work Remotely // Programming

Feed registry: `feed-registry.json`

Available routes:

- `GET /api`
- `GET /api/health`
- `GET /api/feeds`
- `GET /api/ingest/rss`
- `GET /api/ingest/rss?feed=<feed-id>`
- `GET /api/sources`
- `GET /api/opportunities`
- `GET /api/opportunities?live=true`
- `GET /api/sync/status`

### Important pipeline boundary

V2.5 deliberately stops after acquisition/parsing:

```text
PUBLIC RSS
   |
   v
FETCH
   |
   v
PARSE
   |
   v
INGESTED CANDIDATE
```

Normalization, deduplication, persistence, source promotion, and scheduled synchronization are later stages. This prevents live feed data from silently entering the trusted source index before the V2.7/V3.0 governance layers exist.

## Feed usage rules

Only public feeds with documented access/use conditions are registered. Where a provider requests attribution or imposes usage restrictions, those requirements remain part of the source integration documentation and must be respected.

The registry should not be expanded merely because a feed is technically reachable. Each new feed must be checked for accessibility, relevance, freshness, licensing/usage conditions, and stability.

## Planned storage

Cloudflare D1 remains the intended relational store because the project needs relationships between sources, feeds, opportunities, and discovery records. D1 will be introduced after the ingestion pipeline has been validated.

## Deployment

The Worker can be deployed separately from GitHub Pages using Wrangler:

```bash
cd backend
wrangler deploy
```

Cloudflare authentication, Worker deployment, and creation of the eventual D1 database remain infrastructure/account operations and are not automated from this repository.

## Security rules

- No API keys belong in `index.html`.
- No secrets are committed to Git.
- External source credentials will be stored as Worker secrets when required.
- Browser requests will use the normalized API boundary.
- Unknown sources remain discovery records until human approval.
- Feed ingestion is server-side so the browser does not need direct access to external feeds.
