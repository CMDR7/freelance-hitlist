# FL-HL // Freelancer Intelligence Network

**FL-HL (Freelancer Hit List)** is a cyberpunk-styled opportunity discovery dashboard and an evolving intelligence-aggregation proof of concept.

The project explores how a lightweight front end, a server-side acquisition API, and aggregated opportunity data can work together as one coherent application. Its purpose at this stage is to demonstrate and develop the connection between the user interface, backend services, and data collected from multiple external sources—not to present the system as a finished production platform.

## Project objective

Build a unified workflow that can:

- Acquire freelance and remote-work opportunities from a defined set of external sources.
- Normalize records into a consistent opportunity format.
- Deduplicate overlapping listings while retaining source attribution and provenance.
- Aggregate the resulting records behind a single API.
- Present, search, filter, and inspect the aggregated opportunities through one responsive interface.
- Explore persistent snapshots, pagination, and operational telemetry as the proof of concept develops.

## Proof of concept // Front end + back end + aggregated data

FL-HL brings three main parts together:

| Layer | Responsibility |
|---|---|
| **Front end** | Responsive dashboard, search and filtering, opportunity presentation, detail views, source context, and pipeline telemetry |
| **Back end** | Server-side source acquisition, normalization, deduplication, source balancing, API responses, and operational diagnostics |
| **Aggregated data** | A unified opportunity collection assembled from multiple feeds and public API connectors, with canonical identity and source attribution |

The intended data flow is:

\`\`\`text
EXTERNAL SOURCES
 RSS / ATOM / PUBLIC APIs
          |
          v
BACKEND ACQUISITION
          |
          v
NORMALIZATION
          |
          v
CANONICAL IDs + DEDUPLICATION
          |
          v
SOURCE BALANCING
          |
          v
AGGREGATED OPPORTUNITY DATA
          |
          v
INTELLIGENCE API
          |
          v
FRONTEND DASHBOARD
 Search / Filter / Inspect
\`\`\`

This is an integration-focused proof of concept. The front end and back end are developed as separate components with a defined API boundary, allowing each layer to evolve without turning the project into a monolithic application.

## Current capabilities

### Dashboard

- Responsive, cyberpunk-inspired interface.
- Search and filtering across opportunity information.
- Opportunity detail views.
- Source context and attribution.
- Pipeline and acquisition telemetry presentation.
- URL-based sharing of search state.
- External search fallbacks when the local opportunity collection does not provide a match.

### Acquisition and data processing

- Six configured acquisition sources: four RSS feeds and two public API connectors.
- Server-side acquisition through the Cloudflare Worker.
- Canonical normalization of opportunity records.
- URL canonicalization and conservative duplicate detection.
- Preservation of provenance and source attribution.
- Freshness classification without automatically treating older listings as closed.
- Source balancing before API response limiting.

The configured source set is intentionally fixed for this proof of concept. Adding sources is a separate design decision.

### V2.9 persistence and retrieval work

The repository includes the V2.9 implementation and D1 integration configuration for:

- Cloudflare D1 persistence schema.
- Pipeline-run and per-source health records.
- Immutable acquisition snapshots.
- Cursor-based pagination with a maximum page size of 100.
- Read-only diagnostics.
- Scheduled acquisition handler support.
- Front-end aggregation across paginated API responses.

The `fl-hl` D1 database is provisioned and its initial migration is recorded. The `main` branch now configures the Worker entry point as V2.9 and binds `DB` to that database for local integration testing through a remote D1 binding. The first acquisition and end-to-end behaviour are still unverified. The production Worker has not been switched, and no production Cron Trigger is enabled.

## Architecture and technology

- **Front end:** HTML, CSS, and vanilla JavaScript.
- **Backend runtime:** Cloudflare Workers.
- **Acquisition inputs:** RSS / Atom feeds and public API connectors.
- **Persistence layer:** Cloudflare D1 (V2.9 implementation; integration verification pending).
- **Deployment model:** Front end and Worker are deployed independently.

The front end communicates with the backend through HTTP API routes. Source acquisition and normalization remain server-side; the browser consumes the normalized opportunity contract rather than directly integrating with each upstream provider.

## Repository structure

\`\`\`text
/
├── index.html
├── legacy.html
├── assets/
├── backend/
│   ├── worker-v28.js
│   ├── worker-v29.js
│   ├── normalize.js
│   ├── wrangler.toml
│   ├── migrations/
│   ├── README.md
│   └── V2.9-ARCHITECTURE.md
├── DATA_CONTRACT.md
└── data-contract.json
\`\`\`

## Development status

**Current development baseline: V2.9 proof of concept, consolidated on \`main\`.**

The V2.9 frontend, Worker implementation, migration, and architecture notes have been consolidated into the main branch. The `main` branch Wrangler configuration now targets `worker-v29.js` and includes the provisioned D1 binding for local integration testing. This repository configuration change does not deploy the Worker; the production Worker remains on V2.8 until the first acquisition, API checks, and pagination tests pass.

Outstanding verification includes:

- Running the first controlled acquisition with Wrangler's local scheduled-event test route and the remote D1 binding.
- Verifying persisted opportunities, snapshot membership, pipeline-run metrics, and six source-health rows.
- Verifying pagination boundaries, including 0, 1, 99, 100, 101, and 200+ records.
- Testing source degradation and partial acquisition outcomes.
- Confirming failed persistence cannot replace the latest successful snapshot.
- Verifying front-end pagination, filters, counts, and detail views end to end.
- Reviewing production configuration before enabling the V2.9 Worker or scheduled acquisition.

The repository should therefore be treated as an active proof of concept and development project. Code being present does not imply that every V2.9 integration path has been verified or deployed.

## Local development

The front end can be opened directly in a browser for interface work. Backend development and testing use the Cloudflare Wrangler tooling from the \`backend/\` directory.

\`\`\`bash
cd backend
wrangler --version
\`\`\`

For the first integration run, start `npx wrangler dev --test-scheduled` from `backend/`, then invoke `http://127.0.0.1:8787/cdn-cgi/local/scheduled?cron=*+*+*+*+*` from a second terminal. The `DB` binding is configured as remote for this test, so the acquisition writes to the provisioned D1 database while the Worker code executes locally. This does not deploy the Worker. Do not run `npx wrangler deploy` or add a production Cron Trigger until the D1 integration and verification steps above are complete.

See [backend/README.md](backend/README.md) and [backend/V2.9-ARCHITECTURE.md](backend/V2.9-ARCHITECTURE.md) for backend details and the V2.9 design contract.

## Project links

- **Live interface:** https://cmdr7.github.io/freelance-hitlist/
- **Repository:** https://github.com/CMDR7/freelance-hitlist

---

**TERMINAL_STREAMS // MULTISTOP_TECH // 2026**
