import legacyWorker from "./worker.js";
import { normalizeAndDeduplicate } from "./normalize.js";

const FEEDS = [
  "remote-first-jobs-ai",
  "jobicy-ai",
  "remoteyeah-engineering",
  "weworkremotely-programming",
];

const CONNECTORS = ["jobicy", "arbeitnow"];

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}

function matches(item, query, region) {
  const haystack = [
    item.title,
    item.employer,
    item.companyName,
    item.company_name,
    item.description,
    item.jobExcerpt,
    item.sourceName,
    item.sourceId,
    ...(Array.isArray(item.tags) ? item.tags : []),
    ...(Array.isArray(item.location) ? item.location : [item.location]),
  ].filter(Boolean).join(" ").toLowerCase();
  return (!query || haystack.includes(query)) && (!region || haystack.includes(region));
}

async function invokeLegacy(request, env, ctx, path) {
  const target = new URL(path, request.url);
  const internalRequest = new Request(target.toString(), {
    method: "GET",
    headers: request.headers,
  });
  const response = await legacyWorker.fetch(internalRequest, env, ctx);
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

async function acquireSources(request, env, ctx, query, region) {
  const specs = [
    ...FEEDS.map((id) => ({ id, kind: "rss", path: `/api/ingest/rss?feed=${encodeURIComponent(id)}` })),
    ...CONNECTORS.map((id) => ({ id, kind: "api", path: `/api/ingest/api?connector=${encodeURIComponent(id)}` })),
  ];

  const settled = await Promise.allSettled(specs.map(async (spec) => {
    const payload = await invokeLegacy(request, env, ctx, spec.path);
    const data = Array.isArray(payload.data) ? payload.data : [];
    return {
      ...spec,
      data: data.filter((item) => matches(item, query, region)),
      rawCount: data.length,
    };
  }));

  const sources = settled.map((result, index) => {
    const spec = specs[index];
    if (result.status === "fulfilled") return { ...result.value, error: null };
    return {
      ...spec,
      data: [],
      rawCount: 0,
      error: String(result.reason?.message || result.reason),
    };
  });

  const candidates = sources.flatMap((source) => source.data.map((item) => ({
    ...item,
    acquisition: item.acquisition || source.kind,
    sourceId: item.sourceId || source.id,
    sourceName: item.sourceName || source.id,
  })));

  return { candidates, sources };
}

function sourceType(item) {
  return Array.isArray(item.acquisition)
    ? item.acquisition.includes("api") && !item.acquisition.includes("rss") ? "api" : "rss"
    : String(item.acquisition || "").toLowerCase() === "api" ? "api" : "rss";
}

function sourceBalance(data) {
  const groups = new Map();
  for (const item of data) {
    const key = `${sourceType(item)}:${item.sourceId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const orderedGroups = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, items]) => items);

  const positions = new Array(orderedGroups.length).fill(0);
  const selected = [];
  let progressed = true;

  while (progressed) {
    progressed = false;
    for (let i = 0; i < orderedGroups.length; i += 1) {
      if (positions[i] >= orderedGroups[i].length) continue;
      selected.push(orderedGroups[i][positions[i]]);
      positions[i] += 1;
      progressed = true;
    }
  }

  return selected;
}

async function handle(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path !== "/api/opportunities") {
    return legacyWorker.fetch(request, env, ctx);
  }

  const live = ["1", "true", "yes"].includes((url.searchParams.get("live") || "").toLowerCase());
  if (!live) return legacyWorker.fetch(request, env, ctx);

  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 100);
  const query = (url.searchParams.get("q") || "").trim().toLowerCase();
  const region = (url.searchParams.get("region") || "").trim().toLowerCase();

  const acquisition = await acquireSources(request, env, ctx, query, region);
  const normalized = await normalizeAndDeduplicate(acquisition.candidates);
  const balanced = sourceBalance(normalized.data);
  const selected = balanced.slice(0, limit);

  const rssSources = acquisition.sources.filter((source) => source.kind === "rss");
  const apiSources = acquisition.sources.filter((source) => source.kind === "api");
  const failed = acquisition.sources.filter((source) => source.error);

  return json({
    version: "2.8.0",
    stage: "normalized-source-balanced-live-display",
    data: selected,
    count: selected.length,
    limit,
    query,
    region,
    pipeline: {
      rssFeedsChecked: rssSources.length,
      rssFeedsSuccessful: rssSources.filter((source) => !source.error).length,
      apiConnectorsChecked: apiSources.length,
      apiConnectorsSuccessful: apiSources.filter((source) => !source.error).length,
      candidatesAcquired: normalized.inputCount,
      candidatesNormalized: normalized.normalizedCount,
      candidatesRejected: normalized.rejectedCount,
      uniqueOpportunities: normalized.uniqueCount,
      duplicatesRemoved: normalized.duplicatesRemoved,
      staleOpportunities: normalized.staleCount,
      unknownFreshness: normalized.unknownFreshnessCount,
      returnedAfterLimit: selected.length,
      sourceBalanced: true,
      failedSources: failed.map((source) => ({ id: source.id, error: source.error })),
      sourceHealth: acquisition.sources,
    },
    persistence: "not-enabled",
    note: "V2.8 acquires live candidates, runs the canonical normalization and deduplication pipeline, then source-balances normalized records before applying the response limit.",
  });
}

export default {
  async fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },
};
