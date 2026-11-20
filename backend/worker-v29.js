import legacyWorker from "./worker.js";
import { normalizeAndDeduplicate } from "./normalize.js";

const API_VERSION = "2.9.0";
const FEEDS = [
  { id: "remote-first-jobs-ai", sourceId: "remote-first-jobs", type: "rss", name: "Remote First Jobs // AI", url: "https://remotefirstjobs.com/rss/jobs/ai.rss" },
  { id: "jobicy-ai", sourceId: "jobicy", type: "rss", name: "Jobicy // AI Remote Jobs", url: "https://jobicy.com/jobs/feed?tag=ai" },
  { id: "remoteyeah-engineering", sourceId: "remoteyeah", type: "rss", name: "RemoteYeah // Engineering", url: "https://remoteyeah.com/rss.xml" },
  { id: "weworkremotely-programming", sourceId: "we-work-remotely", type: "rss", name: "We Work Remotely // Programming", url: "https://weworkremotely.com/categories/remote-programming-jobs.rss" },
];
const CONNECTORS = [
  { id: "jobicy", type: "api", name: "Jobicy Public Jobs API", url: "https://jobicy.com/api/v2/remote-jobs?count=100&industry=data-science" },
  { id: "arbeitnow", type: "api", name: "Arbeitnow Free Job Board API", url: "https://www.arbeitnow.com/api/job-board-api" },
];
const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: HEADERS });
}
function sourceType(item) {
  return Array.isArray(item.acquisition)
    ? item.acquisition.includes("api") && !item.acquisition.includes("rss") ? "api" : "rss"
    : String(item.acquisition || "").toLowerCase() === "api" ? "api" : "rss";
}
function balanceSources(data) {
  const groups = new Map();
  for (const item of data) {
    const key = `${sourceType(item)}:${item.sourceId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, items]) => items);
  const positions = new Array(ordered.length).fill(0);
  const result = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (let i = 0; i < ordered.length; i += 1) {
      if (positions[i] < ordered[i].length) {
        result.push(ordered[i][positions[i]++]);
        progressed = true;
      }
    }
  }
  return result;
}
async function invokeLegacy(origin, path) {
  const response = await legacyWorker.fetch(new Request(new URL(path, origin), {
    method: "GET",
    headers: { Accept: "application/json" },
  }), {}, {});
  const payload = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${payload.message || payload.error || "source request failed"}`);
  return payload;
}
async function acquireSources(origin) {
  const specs = [
    ...FEEDS.map((feed) => ({ ...feed, path: `/api/ingest/rss?feed=${encodeURIComponent(feed.id)}` })),
    ...CONNECTORS.map((connector) => ({ ...connector, sourceId: connector.id, path: `/api/ingest/api?connector=${encodeURIComponent(connector.id)}` })),
  ];
  const settled = await Promise.all(specs.map(async (spec) => {
    const started = Date.now();
    try {
      const payload = await invokeLegacy(origin, spec.path);
      const items = Array.isArray(payload.data) ? payload.data : [];
      const embedded = spec.type === "rss" ? payload.results?.[0] : payload;
      const sourceStatus = embedded?.status || (items.length ? "healthy" : "empty");
      return {
        spec, items, latencyMs: Date.now() - started, httpStatus: 200,
        status: sourceStatus === "healthy" ? (items.length ? "healthy" : "empty") : sourceStatus,
        error: embedded?.error || null,
      };
    } catch (error) {
      return {
        spec, items: [], latencyMs: Date.now() - started, httpStatus: null,
        status: "degraded", error: String(error?.message || error),
      };
    }
  }));
  const candidates = settled.flatMap(({ spec, items }) => items.map((item) => ({
    ...item,
    sourceId: item.sourceId || spec.sourceId,
    sourceName: item.sourceName || spec.name,
    acquisition: item.acquisition || spec.type,
  })));
  const health = settled.map(({ spec, items, latencyMs, httpStatus, status, error }) => ({
    source_id: spec.sourceId,
    source_type: spec.type,
    source_name: spec.name,
    endpoint: spec.url,
    status: ["healthy", "empty", "timeout", "invalid"].includes(status) ? status : "degraded",
    http_status: httpStatus,
    latency_ms: latencyMs,
    candidate_count: items.length,
    parsed_count: items.length,
    checked_at: new Date().toISOString(),
    error,
  }));
  return { candidates, health };
}
function recordSearchText(item) {
  return [
    item.title, item.employer, item.description, item.sourceName,
    ...(item.tags || []), ...(item.location || []), ...(item.engagement || []),
  ].filter(Boolean).join(" ").toLowerCase();
}
function recordRegionText(item) {
  return (item.location || []).join(" ").toLowerCase();
}
function cursorEncode(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function cursorDecode(value) {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed.runId !== "string" || !Number.isInteger(parsed.ordinal) || parsed.ordinal < -1) return null;
    if (typeof parsed.query !== "string" || typeof parsed.region !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}
function likeLiteral(value) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
async function insertChunks(db, statements, size = 40) {
  for (let i = 0; i < statements.length; i += size) {
    await db.batch(statements.slice(i, i + size));
  }
}
async function runAcquisition(env, triggerType = "scheduled", scheduledAt = null) {
  if (!env.DB) throw new Error("D1 binding DB is required for V2.9 acquisition.");
  const db = env.DB;
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  await db.prepare(
    "INSERT INTO pipeline_runs (run_id, trigger_type, scheduled_at, started_at, status) VALUES (?, ?, ?, ?, 'running')"
  ).bind(runId, triggerType, scheduledAt, startedAt).run();

  try {
    const acquired = await acquireSources("https://fl-hl-internal.invalid");
    const normalized = await normalizeAndDeduplicate(acquired.candidates);
    const balanced = balanceSources(normalized.data);
    const now = new Date().toISOString();

    const opportunityStatements = balanced.map((item) => {
      const searchText = recordSearchText(item);
      const regionText = recordRegionText(item);
      const recordJson = JSON.stringify(item);
      return db.prepare(`INSERT INTO opportunities (
        canonical_id, source_id, source_name, employer, title, canonical_url,
        published_at, updated_at, retrieved_at, status, freshness,
        location_json, tags_json, engagement_json, description,
        attribution_json, provenance_json, record_json, search_text, region_text,
        first_seen_at, last_seen_at, last_seen_run_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(canonical_id) DO UPDATE SET
        source_id=excluded.source_id, source_name=excluded.source_name,
        employer=excluded.employer, title=excluded.title, canonical_url=excluded.canonical_url,
        published_at=excluded.published_at, updated_at=excluded.updated_at,
        retrieved_at=excluded.retrieved_at, status=excluded.status, freshness=excluded.freshness,
        location_json=excluded.location_json, tags_json=excluded.tags_json,
        engagement_json=excluded.engagement_json, description=excluded.description,
        attribution_json=excluded.attribution_json, provenance_json=excluded.provenance_json,
        record_json=excluded.record_json, search_text=excluded.search_text,
        region_text=excluded.region_text, last_seen_at=excluded.last_seen_at,
        last_seen_run_id=excluded.last_seen_run_id`).bind(
          item.canonicalId || item.id, item.sourceId || "unknown-source", item.sourceName || "Unknown source",
          item.employer || "Unknown employer", item.title || "Untitled opportunity", item.url,
          item.publishedAt, item.updatedAt, item.retrievedAt || now, item.status || "active",
          item.freshness || "unknown", JSON.stringify(item.location || []), JSON.stringify(item.tags || []),
          JSON.stringify(item.engagement || []), item.description || "", JSON.stringify(item.attribution || null),
          JSON.stringify(item.provenance || {}), recordJson, searchText, regionText, now, now, runId
        );
    });
    await insertChunks(db, opportunityStatements);

    const membershipStatements = balanced.map((item, ordinal) => db.prepare(`INSERT INTO pipeline_run_opportunities (
      run_id, canonical_id, ordinal, source_id, source_type,
      snapshot_record_json, snapshot_search_text, snapshot_region_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      runId, item.canonicalId || item.id, ordinal, item.sourceId || "unknown-source",
      sourceType(item), JSON.stringify(item), recordSearchText(item), recordRegionText(item)
    ));
    await insertChunks(db, membershipStatements);

    const sourceStatements = acquired.health.map((source) => db.prepare(`INSERT INTO source_health (
      run_id, source_id, source_type, source_name, endpoint, status, http_status,
      latency_ms, candidate_count, parsed_count, checked_at, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      runId, source.source_id, source.source_type, source.source_name, source.endpoint,
      source.status, source.http_status, source.latency_ms, source.candidate_count,
      source.parsed_count, source.checked_at, source.error
    ));
    await insertChunks(db, sourceStatements);

    const failedSources = acquired.health.filter((source) => !["healthy", "empty"].includes(source.status)).length;
    const healthySources = acquired.health.length - failedSources;
    const runStatus = healthySources === 0 ? "failed" : failedSources ? "partial" : "success";
    if (runStatus === "failed") throw new Error("All configured sources failed; latest snapshot was not replaced.");

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startedMs;
    const metrics = {
      rssFeedsChecked: acquired.health.filter((source) => source.source_type === "rss").length,
      rssFeedsSuccessful: acquired.health.filter((source) => source.source_type === "rss" && ["healthy", "empty"].includes(source.status)).length,
      apiConnectorsChecked: acquired.health.filter((source) => source.source_type === "api").length,
      apiConnectorsSuccessful: acquired.health.filter((source) => source.source_type === "api" && ["healthy", "empty"].includes(source.status)).length,
      candidatesAcquired: normalized.inputCount,
      candidatesNormalized: normalized.normalizedCount,
      candidatesRejected: normalized.rejectedCount,
      uniqueOpportunities: normalized.uniqueCount,
      duplicatesRemoved: normalized.duplicatesRemoved,
      staleOpportunities: normalized.staleCount,
      unknownFreshness: normalized.unknownFreshnessCount,
      sourceBalanced: true,
    };
    const metadata = JSON.stringify({ ...metrics, sourceCount: acquired.health.length });
    await db.batch([
      db.prepare(`UPDATE pipeline_runs SET completed_at=?, duration_ms=?, status=?,
        rss_sources_checked=?, rss_sources_healthy=?, api_sources_checked=?, api_sources_healthy=?,
        candidates_acquired=?, candidates_normalized=?, candidates_rejected=?,
        unique_opportunities=?, duplicates_removed=?, stale_opportunities=?, unknown_freshness=?, returned_opportunities=?
        WHERE run_id=?`).bind(
          completedAt, durationMs, runStatus, metrics.rssFeedsChecked, metrics.rssFeedsSuccessful,
          metrics.apiConnectorsChecked, metrics.apiConnectorsSuccessful, normalized.inputCount,
          normalized.normalizedCount, normalized.rejectedCount, normalized.uniqueCount,
          normalized.duplicatesRemoved, normalized.staleCount, normalized.unknownFreshnessCount, balanced.length, runId
        ),
      db.prepare(`INSERT INTO latest_payload (singleton_id, run_id, generated_at, total_records, metadata_json)
        VALUES (1, ?, ?, ?, ?)
        ON CONFLICT(singleton_id) DO UPDATE SET run_id=excluded.run_id,
        generated_at=excluded.generated_at, total_records=excluded.total_records,
        metadata_json=excluded.metadata_json`).bind(runId, completedAt, balanced.length, metadata),
    ]);
    return { runId, status: runStatus, total: balanced.length, durationMs, metrics };
  } catch (error) {
    const completedAt = new Date().toISOString();
    await db.prepare("UPDATE pipeline_runs SET completed_at=?, duration_ms=?, status='failed', error_summary=? WHERE run_id=?")
      .bind(completedAt, Date.now() - startedMs, String(error?.message || error), runId).run();
    throw error;
  }
}
async function getOpportunities(url, env) {
  if (!env.DB) return json({ error: "PERSISTENCE_NOT_CONFIGURED", message: "V2.9 requires the D1 DB binding." }, 503);
  const db = env.DB;
  const limitValue = Number.parseInt(url.searchParams.get("limit") || "50", 10);
  const limit = Math.min(Math.max(Number.isFinite(limitValue) ? limitValue : 50, 1), 100);
  const query = (url.searchParams.get("q") || "").trim().toLowerCase();
  const region = (url.searchParams.get("region") || "").trim().toLowerCase();
  const cursorParam = url.searchParams.get("cursor");
  let runId;
  let ordinal = -1;

  if (cursorParam) {
    const cursor = cursorDecode(cursorParam);
    if (!cursor || cursor.query !== query || cursor.region !== region) {
      return json({ error: "INVALID_CURSOR", message: "Cursor is invalid or does not match the active filters." }, 400);
    }
    runId = cursor.runId;
    ordinal = cursor.ordinal;
    const exists = await db.prepare("SELECT status FROM pipeline_runs WHERE run_id=?").bind(runId).first();
    if (!exists || !["success", "partial"].includes(exists.status)) {
      return json({ error: "SNAPSHOT_EXPIRED", message: "This result snapshot is no longer available. Refresh the opportunity feed." }, 410);
    }
  } else {
    const latest = await db.prepare("SELECT run_id FROM latest_payload WHERE singleton_id=1").first();
    if (!latest) return json({ error: "NO_SNAPSHOT", message: "No completed acquisition snapshot is available yet." }, 503);
    runId = latest.run_id;
  }

  const snapshot = await db.prepare(`SELECT generated_at, total_records FROM latest_payload WHERE singleton_id=1 AND run_id=?`).bind(runId).first();
  const run = await db.prepare("SELECT * FROM pipeline_runs WHERE run_id=?").bind(runId).first();
  if (!run || !["success", "partial"].includes(run.status)) {
    return json({ error: "SNAPSHOT_EXPIRED", message: "This result snapshot is no longer available. Refresh the opportunity feed." }, 410);
  }
  const conditions = ["run_id = ?", "ordinal > ?"];
  const params = [runId, ordinal];
  if (query) {
    conditions.push("instr(snapshot_search_text, ?) > 0");
    params.push(query);
  }
  if (region) {
    conditions.push("instr(snapshot_region_text, ?) > 0");
    params.push(region);
  }
  const where = conditions.join(" AND ");
  const countRow = await db.prepare(`SELECT COUNT(*) AS count FROM pipeline_run_opportunities WHERE run_id=? ${query ? "AND instr(snapshot_search_text, ?) > 0" : ""} ${region ? "AND instr(snapshot_region_text, ?) > 0" : ""}`)
    .bind(runId, ...(query ? [query] : []), ...(region ? [region] : [])).first();
  const rows = await db.prepare(`SELECT ordinal, snapshot_record_json FROM pipeline_run_opportunities
    WHERE ${where} ORDER BY ordinal ASC LIMIT ?`).bind(...params, limit + 1).all();
  const fetched = rows.results || [];
  const hasMore = fetched.length > limit;
  const page = fetched.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? cursorEncode({ runId, ordinal: last.ordinal, query, region }) : null;
  const sourceRows = await db.prepare("SELECT * FROM source_health WHERE run_id=? ORDER BY source_type, source_id").bind(runId).all();
  const pipeline = {
    rssFeedsChecked: run.rss_sources_checked,
    rssFeedsSuccessful: run.rss_sources_healthy,
    apiConnectorsChecked: run.api_sources_checked,
    apiConnectorsSuccessful: run.api_sources_healthy,
    candidatesAcquired: run.candidates_acquired,
    candidatesNormalized: run.candidates_normalized,
    candidatesRejected: run.candidates_rejected,
    uniqueOpportunities: run.unique_opportunities,
    duplicatesRemoved: run.duplicates_removed,
    staleOpportunities: run.stale_opportunities,
    unknownFreshness: run.unknown_freshness,
    sourceBalanced: true,
    sourceHealth: (sourceRows.results || []).map((source) => ({
      sourceId: source.source_id, sourceType: source.source_type, name: source.source_name,
      status: source.status, count: source.candidate_count, checkedAt: source.checked_at,
      error: source.error, latencyMs: source.latency_ms, httpStatus: source.http_status,
    })),
  };
  const latestGeneratedAt = snapshot?.generated_at || run.completed_at;
  const total = snapshot?.total_records ?? await db.prepare("SELECT COUNT(*) AS count FROM pipeline_run_opportunities WHERE run_id=?").bind(runId).first().then((r) => r.count);
  return json({
    version: API_VERSION,
    stage: "persistent-normalized-snapshot",
    data: page.map((row) => JSON.parse(row.snapshot_record_json)),
    count: page.length,
    total,
    filteredTotal: countRow?.count || 0,
    limit,
    hasMore,
    nextCursor,
    snapshotRunId: runId,
    generatedAt: latestGeneratedAt,
    query,
    region,
    persistence: "d1",
    pipeline,
  });
}
async function diagnostics(env) {
  if (!env.DB) return json({ error: "PERSISTENCE_NOT_CONFIGURED" }, 503);
  const latest = await env.DB.prepare("SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT 1").first();
  if (!latest) return json({ version: API_VERSION, status: "awaiting-first-run", latestRun: null, sources: [] });
  const sources = await env.DB.prepare("SELECT * FROM source_health WHERE run_id=? ORDER BY source_type, source_id").bind(latest.run_id).all();
  const payload = await env.DB.prepare("SELECT * FROM latest_payload WHERE singleton_id=1").first();
  return json({
    version: API_VERSION,
    status: latest.status,
    latestRun: latest,
    latestPayload: payload,
    sources: sources.results || [],
    freshness: payload?.generated_at ? { generatedAt: payload.generated_at, ageSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(payload.generated_at)) / 1000)) } : null,
  });
}
async function handle(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  if (path === "/api/health") return json({
    status: env.DB ? "healthy" : "degraded",
    apiVersion: API_VERSION,
    timestamp: new Date().toISOString(),
    storage: env.DB ? "d1-configured" : "not-configured",
    ingestion: "scheduled",
    normalization: "enabled",
    deduplication: "enabled",
    pagination: "cursor",
    maxPageSize: 100,
  });
  if (path === "/api/opportunities" && ["1", "true", "yes"].includes((url.searchParams.get("live") || "").toLowerCase())) {
    return getOpportunities(url, env);
  }
  if (path === "/api/diagnostics" || path === "/api/sync/status") return diagnostics(env);
  if (path === "/api/sources" && env.DB) {
    const latest = await env.DB.prepare("SELECT run_id FROM pipeline_runs ORDER BY started_at DESC LIMIT 1").first();
    if (!latest) return json({ version: API_VERSION, data: [], count: 0, status: "awaiting-first-run" });
    const rows = await env.DB.prepare("SELECT * FROM source_health WHERE run_id=? ORDER BY source_type, source_id").bind(latest.run_id).all();
    return json({
      version: API_VERSION,
      data: (rows.results || []).map((source) => ({
        sourceId: source.source_id, sourceType: source.source_type, id: source.source_id,
        name: source.source_name, url: source.endpoint, status: source.status,
        count: source.candidate_count, checkedAt: source.checked_at,
        error: source.error, latencyMs: source.latency_ms, httpStatus: source.http_status,
      })),
      count: rows.results?.length || 0,
      status: "persisted",
    });
  }
  return legacyWorker.fetch(request, env, ctx);
}
export default {
  fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },
  async scheduled(controller, env) {
    const result = await runAcquisition(env, "scheduled", new Date(controller.scheduledTime).toISOString());
    console.log(JSON.stringify({ event: "fl_hl_v29_scheduled_run", ...result }));
  },
};
