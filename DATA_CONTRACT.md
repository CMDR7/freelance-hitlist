# FL-HL // DATA CONTRACT v2.2

## Purpose

This contract separates the Freelancer Hit List into independent data objects so the current static dashboard can later consume live APIs, RSS/Atom feeds, publication feeds, and other normalized sources without changing the presentation layer.

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

Access state is deliberately separate from verification. A curated source may still require onboarding or login.

### 2. Opportunity

Represents an individual job, contract, project, evaluation task, research task, or other workforce opportunity.

Required identity:

- `id`
- `sourceId`
- `title`
- `url`
- `engagement[]`
- `location[]`
- `status`

An opportunity always points back to a source through `sourceId`.

Important timestamps:

- `publishedAt` = when the originating source says the opportunity was published
- `updatedAt` = when the originating source says it was updated
- `retrievedAt` = when FL-HL obtained the record

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

Discovery is intentionally separated from the curated source index. Unknown sources must pass human review before becoming `curated`.

Lifecycle:

`pending → approved → curated`

or

`pending → rejected`

### 5. Sync Status

Represents the health and output of an ingestion run. This supports future live-status UI without coupling the frontend to a particular backend implementation.

## Governance Rules

1. **Known curated sources may be ingested automatically.**
2. **Unknown sources may be discovered automatically but are never silently promoted to curated status.**
3. **Human review is authoritative for source promotion.**
4. **Opportunity data is separate from source data.**
5. **External failures must not erase the last known good cached dataset.**
6. **Free APIs are optional acquisition channels, not architectural dependencies.**
7. **RSS/Atom/publication feeds are first-class acquisition channels.**
8. **The frontend consumes normalized data rather than talking directly to individual external providers.**

## Compatibility with the Current Dashboard

The existing `jobData` records remain the presentation-layer seed data during V2.2. V2.3 will introduce an adapter that maps the existing records into the normalized contract.

No live ingestion is introduced in V2.2.

## Future Flow

```text
External APIs / RSS / Atom / Publications
                ↓
           Acquisition
                ↓
             Parser
                ↓
           Normalizer
                ↓
          Deduplicator
                ↓
             Cache
                ↓
         Intelligence API
                ↓
        Frontend Data Adapter
                ↓
             FL-HL UI
```

## Versioning

**Contract version: 2.2.0**

Changes to required fields, object relationships, enums, or governance semantics should increment the contract version and be documented before downstream implementation changes are made.
