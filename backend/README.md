# FL-HL // Intelligence API

Current backend baseline: V2.9 integration candidate. The V2.8 Worker remains the last production deployment until the V2.9 first-run and pagination gates pass.

## Canonical pipeline

```text
RSS / ATOM / PUBLIC APIs
          |
          v
SERVER-SIDE ACQUISITION
          |
          v
CANONICAL NORMALIZATION
          |
          v
CANONICAL IDs + DEDUPLICATION
          |
          v
SOURCE BALANCING
          |
          v
D1 OPPORTUNITY + SNAPSHOT PERSISTENCE
          |
          v
CURSOR-PAGINATED INTELLIGENCE API
          |
          v
FRONTEND DASHBOARD
```

The six configured sources remain fixed: four RSS feeds and two public API connectors. Source expansion requires separate approval.

## Normalization and identity

`normalize.js` is the canonical transformation layer. It handles URL validation and canonicalization, tracking-parameter removal, Unicode/text normalization, employer and metadata normalization, timestamp normalization, freshness classification, SHA-256-derived canonical IDs, provenance, attribution, duplicate merging, duplicate counts, and malformed-record rejection.

Deduplication uses canonical URL first and employer + title + location as the secondary semantic key when the employer is known.

Freshness is informational:
- `fresh`: published within 45 days
- `stale`: published more than 45 days ago
- `unknown`: no usable publication timestamp

A stale listing is not automatically treated as closed.

## V2.9 persistence

The initial D1 migration is `migrations/0001_v29_initial.sql`. The provisioned database is named `fl-hl`; the Worker binding is `DB`.

The schema stores:
- `pipeline_runs`: acquisition run state and pipeline counters.
- `source_health`: one source-level telemetry record per configured source and run.
- `opportunities`: current canonical records.
- `pipeline_run_opportunities`: immutable, ordered snapshot membership and frozen records for pagination.
- `latest_payload`: pointer and metadata for the latest completed snapshot.
- `pipeline_state`: operational key/value state.

The D1 migration has been applied. The first acquisition run has not yet been verified.

## API routes

Read-only routes:
- `GET /api`
- `GET /api/health`
- `GET /api/feeds`
- `GET /api/connectors`
- `GET /api/sources`
- `GET /api/sync/status`
- `GET /api/diagnostics`
- `GET /api/opportunities?live=true&limit=100`

The opportunities route reads the latest completed D1 snapshot. It supports `q`, `region`, and an opaque `cursor`; page size is capped at 100. The response includes `hasMore`, `nextCursor`, `snapshotRunId`, `total`, `filteredTotal`, and pipeline telemetry.

The legacy ingestion adapters remain internal to the V2.9 Worker. There is no public administrative mutation route.

## Local integration test

From the `backend/` directory, the Wrangler configuration binds `DB` to the provisioned D1 database using a remote binding for local testing.

Start the local Worker with scheduled-event testing enabled:

```bash
npx wrangler dev --test-scheduled
```

Then, from a second terminal session, invoke one controlled acquisition:

```bash
curl -i "http://127.0.0.1:8787/cdn-cgi/local/scheduled?cron=*+*+*+*+*"
```

This runs the local Worker code's `scheduled()` handler and writes its acquisition run to the configured remote D1 database. It does not deploy the Worker or enable a production Cron Trigger. Check the Wrangler terminal output, then query the `pipeline_runs`, `source_health`, `opportunities`, `pipeline_run_opportunities`, and `latest_payload` tables.

While the local server is running, validate:
- `GET http://127.0.0.1:8787/api/health`
- `GET http://127.0.0.1:8787/api/diagnostics`
- `GET http://127.0.0.1:8787/api/opportunities?live=true&limit=100`

For pagination, continue with the returned `nextCursor` and verify that all pages retain the same `snapshotRunId` and contain no duplicate canonical IDs.

## Deployment boundary

The Worker deploys separately from GitHub Pages:

```bash
cd backend
npx wrangler deploy
```

Do not run the deployment command yet. First verify the controlled acquisition, read API behaviour, source health, and pagination. The production Cron Trigger (target cadence: every 12 hours UTC) is intentionally not configured until those checks pass.

Cloudflare credentials remain local to Wrangler and must never be committed to Git.
