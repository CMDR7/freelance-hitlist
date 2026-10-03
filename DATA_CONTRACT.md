# FL-HL // DATA CONTRACT v2.8

## Purpose

This contract defines the normalized data model used by Freelancer // Intelligence Network (FL-HL) across live RSS and public API acquisition, canonical normalization, deduplication, freshness classification, source attribution, provenance, and the intelligence API.

The presentation layer consumes normalized opportunity records. External providers are acquisition inputs, not frontend dependencies.

## Core Objects

### 1. Source

Represents an organization, platform, agency, marketplace, network, aggregator, or other trusted/discovered source.

Required identity:

- `id`
- `name`
- `type`
- `url`
- `region[]`
- `categories[]`
- `verification`

`verification` is the source governance state:

- `curated` = manually reviewed and trusted for normal ingestion
- `discovered` = automatically detected and awaiting review
- `rejected` = explicitly excluded from the trusted network

Access state remains separate from verification. A curated source may still require onboarding or login.

### 2. Opportunity

Represents an individual job, contract, project, evaluation task, research task, or other workforce opportunity.

Normalized opportunity records include:

- `id` / `canonicalId`
- `sourceId`
- `sourceName`
- `employer`
- `title`
- `url`
- `engagement[]`
- `location[]`
- `tags[]`
- `status`
- `freshness`
- `publishedAt`
- `updatedAt`
- `retrievedAt`
- `attribution`
- `acquisition[]`
- `stage`
- `provenance`
- `duplicateCount`

`canonicalId` is derived deterministically from the canonical URL.

### 3. Feed

Represents an acquisition channel belonging to a source.

Supported feed types:

- `api`
- `rss`
- `atom`
- `json`
- `publication`
- `career-page`
- `manual`

A source may expose multiple feeds. Feed health is tracked independently from source verification.

### 4. Discovery

Represents a previously unknown source detected by ingestion.

Unknown sources are never silently promoted to curated status.

Lifecycle:

`pending → approved → curated`

or

`pending → rejected`

### 5. Sync Status

Represents the health and output of an ingestion run. It supports live-status reporting without coupling the frontend to a particular provider implementation.

## Normalization Rules

1. Source URLs and opportunity URLs are canonicalized before identity is derived.
2. Tracking parameters such as `utm_*`, `gclid`, `fbclid`, `ref`, and `source` are removed from canonical URLs.
3. Opportunity records are deduplicated by canonical URL first and semantic identity second.
4. Duplicate records are merged rather than emitted repeatedly.
5. Published timestamps are parsed to ISO 8601 when valid.
6. Freshness is `fresh`, `stale`, or `unknown`; the current stale threshold is 45 days.
7. Attribution and provenance are preserved through normalization and duplicate merging.
8. Invalid candidates without a usable HTTP(S) URL are rejected.
9. Normalized records are marked with stage `normalized`.

## V2.8 Live Pipeline

The live V2.8 path is:

```text
External RSS / public APIs
          ↓
       Acquisition
          ↓
       Normalization
          ↓
Canonical + semantic deduplication
          ↓
     Freshness classification
          ↓
    Source balancing
          ↓
    Response limiting
          ↓
     Intelligence API
          ↓
          UI
```

The V2.8 worker reuses the canonical `normalizeAndDeduplicate()` implementation from `backend/normalize.js`. It does not maintain a second normalization implementation.

## Governance Rules

1. Known curated sources may be ingested automatically.
2. Unknown sources may be discovered automatically but are never silently promoted to curated status.
3. Human review is authoritative for source promotion.
4. Opportunity data is separate from source data.
5. External failures must not erase a last known good cached dataset once persistence is enabled.
6. Free APIs are optional acquisition channels, not architectural dependencies.
7. RSS/Atom/publication feeds are first-class acquisition channels.
8. The frontend consumes normalized data rather than talking directly to individual external providers.
9. Pipeline telemetry must report actual processing counts.
10. Persistence and scheduled synchronization remain disabled until the normalization layer is authoritative and validated.

## Versioning

**Contract version: 2.8.0**

The contract version tracks schema/governance semantics. API release versions and source registry versions may evolve independently when their schemas have not changed.
