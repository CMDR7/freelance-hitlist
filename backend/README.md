# FL-HL // Intelligence API

V2.7 activates the normalization and deduplication layer for the Freelancer // Intelligence Network.

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
     |
     v
NORMALIZE
     |
     v
CANONICAL ID
     |
     v
DEDUPLICATE
     |
     v
NORMALIZED OPPORTUNITY
```

## V2.7 normalization

`backend/normalize.js` is the canonical transformation layer between external candidates and the FL-HL opportunity contract.

It currently handles:

- URL validation and canonicalization
- removal of common tracking parameters
- Unicode/text normalization
- employer normalization
- engagement/location/tag normalization
- publication/retrieval timestamp normalization
- freshness classification
- canonical opportunity IDs using SHA-256
- provenance tracking across feeds and acquisition types
- source attribution preservation
- duplicate merging
- duplicate counting
- malformed-record rejection

Cloudflare Workers provides Web Crypto through `crypto.subtle`, including SHA-256 digest support, so the canonical IDs do not require a Node.js crypto dependency. citeturn0search0

## Deduplication policy

FL-HL uses a conservative two-stage identity strategy:

1. **Canonical URL match** is the primary duplicate key.
2. **Employer + title + location** is the secondary semantic key when the employer is known.

This prevents obvious cross-feed duplicates without aggressively collapsing unrelated jobs that merely have similar titles.

When duplicates are merged, the resulting record retains:

- one canonical opportunity ID
- merged tags/location/engagement data
- merged provenance
- source attribution
- the best available description
- the latest available retrieval/update metadata
- `duplicateCount`

## Freshness

Freshness is informational and does not automatically close a job.

- `fresh` = published within 45 days
- `stale` = published more than 45 days ago
- `unknown` = no usable publication timestamp

A stale listing remains visible until a later lifecycle stage establishes a reliable closed/stale policy.

## V2.7 live route

```text
GET /api/opportunities?live=true
```

This route acquires the current RSS and API candidates, normalizes them, deduplicates them in memory, and returns the resulting normalized opportunity collection.

Optional query parameters:

```text
?live=true&limit=50
?live=true&q=AI trainer
?live=true&region=Germany
```

The response also includes pipeline metrics:

- candidates acquired
- candidates normalized
- candidates rejected
- unique opportunities
- duplicates removed
- stale opportunities
- unknown-freshness opportunities

## Persistence boundary

V2.7 is intentionally **in-memory only**.

```text
RSS / API
   |
   v
INGESTED CANDIDATES
   |
   v
NORMALIZATION
   |
   v
DEDUPLICATION
   |
   v
NORMALIZED RESULTS
   |
   X  D1 persistence (later)
```

This lets us validate data quality before introducing storage and scheduled synchronization.

## Attribution

Attribution is a first-class contract field. Required provider attribution is preserved through normalization so the V2.8 presentation layer can render the correct source credit.

Remote First Jobs and We Work Remotely explicitly request source attribution. Jobicy's current API terms also require preserving the canonical Jobicy URL and source attribution.

## Routes

- `GET /api`
- `GET /api/health`
- `GET /api/feeds`
- `GET /api/connectors`
- `GET /api/ingest/rss`
- `GET /api/ingest/rss?feed=<feed-id>`
- `GET /api/ingest/api?connector=jobicy`
- `GET /api/ingest/api?connector=arbeitnow`
- `GET /api/opportunities`
- `GET /api/opportunities?live=true`
- `GET /api/sources`
- `GET /api/sync/status`

## Security

- No API keys belong in `index.html`.
- No secrets are committed to Git.
- Browser requests use the normalized API boundary.
- API ingestion runs server-side.
- Unknown sources remain discovery records until human approval.
- V2.7 ingestion remains on-demand; scheduled synchronization is intentionally deferred.

## Deployment

The Worker can be deployed separately from GitHub Pages using Wrangler:

```bash
cd backend
wrangler deploy
```

Cloudflare authentication, Worker deployment, and D1 creation remain infrastructure/account operations and are not automated from this repository.
