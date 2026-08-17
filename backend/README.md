# FL-HL // Intelligence API

V2.6 adds the first selective free-API acquisition layer to the Freelancer // Intelligence Network.

## Pipeline

```text
FL-HL CLIENT
     |
     v
INTELLIGENCE API
     |
     +--> D1 / cache                         <-- future
     +--> RSS / Atom feeds                   <-- V2.5
     +--> publication feeds                  <-- future
     +--> approved free APIs                 <-- V2.6
```

## V2.6 connectors

### Jobicy Public Jobs API

- Public JSON endpoint
- No API key
- Up to 100 listings/request
- Canonical Jobicy URLs must be preserved
- Attribution is required
- Requests must be cached/controlled and must not run more frequently than once per hour

### Arbeitnow Free Job Board API

- Public JSON endpoint
- No API key
- European job data
- Includes a remote indicator
- Source attribution is retained in FL-HL records

Connector registry: `api-connectors.json`

RSS registry: `feed-registry.json`

## Routes

- `GET /api`
- `GET /api/health`
- `GET /api/feeds`
- `GET /api/connectors`
- `GET /api/ingest/rss`
- `GET /api/ingest/rss?feed=<feed-id>`
- `GET /api/ingest/api?connector=jobicy`
- `GET /api/ingest/api?connector=arbeitnow`
- `GET /api/sources`
- `GET /api/opportunities`
- `GET /api/sync/status`

## Important pipeline boundary

V2.6 still stops at **ingested candidates**. Connector responses are fetched and mapped into the canonical opportunity shape, but they are not yet persisted into D1, deduplicated, promoted into the curated source index, or used to replace the static frontend dataset.

```text
RSS / API
   |
   v
FETCH
   |
   v
PARSE / MAP
   |
   v
INGESTED CANDIDATE
   |
   +---- V2.7 NORMALIZE + DEDUPLICATE
```

## Attribution

Attribution metadata is now a first-class field in `data-contract.json`. Required provider attribution is preserved with each ingested candidate so the eventual V2.8 presentation layer can render the correct source credit.

Remote First Jobs and We Work Remotely explicitly request source attribution. Jobicy's current API terms also require preserving the canonical Jobicy URL and source attribution.

## Security

- No API keys belong in `index.html`.
- No secrets are committed to Git.
- Browser requests use the normalized API boundary.
- API ingestion runs server-side.
- Unknown sources remain discovery records until human approval.
- V2.6 ingestion is on-demand; scheduled synchronization is intentionally deferred.

## Deployment

The Worker can be deployed separately from GitHub Pages using Wrangler:

```bash
cd backend
wrangler deploy
```

Cloudflare authentication, Worker deployment, and D1 creation remain infrastructure/account operations and are not automated from this repository.
