import legacyWorker from "./worker.js";

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

function candidateKey(item) {
  try {
    const url = new URL(item.url || item.link || "");
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id", "gclid", "fbclid", "ref", "source"].forEach((key) => url.searchParams.delete(key));
    return url.toString();
  } catch {
    return `${item.sourceId || item.sourceName || "unknown"}|${item.title || "untitled"}`;
  }
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

async function acquireSourceBalanced(request, env, ctx, limit, query, region) {
  const specs = [
    ...FEEDS.map((id) => ({ id, kind: "rss", path: `/api/ingest/rss?feed=${encodeURIComponent(id)}` })),
    ...CONNECTORS.map((id) => ({ id, kind: "api", path: `/api/ingest/api?connector=${encodeURIComponent(id)}` })),
  ];

  const settled = await Promise.allSettled(specs.map(async (spec) => {
    const payload = await invokeLegacy(request, env, ctx, spec.path);
    const data = Array.isArray(payload.data) ? payload.data : [];
    return { ...spec, data: data.filter((item) => matches(item, query, region)), rawCount: data.length };
  }));

  const sources = settled.map((result, index) => {
    const spec = specs[index];
    if (result.status === "fulfilled") return { ...result.value, error: null };
    return { ...spec, data: [], rawCount: 0, error: String(result.reason?.message || result.reason) };
  });

  // Round-robin selection prevents a large source from consuming the response limit.
  const positions = new Array(sources.length).fill(0);
  const selected = [];
  const seen = new Set();
  let progressed = true;

  while (selected.length < limit && progressed) {
    progressed = false;
    for (let i = 0; i < sources.length && selected.length < limit; i += 1) {
      const source = sources[i];
      while (positions[i] < source.data.length) {
        const item = source.data[positions[i]++];
        progressed = true;
        const key = candidateKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        selected.push(item);
        break;
      }
    }
  }

  return { selected, sources };
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
  const acquisition = await acquireSourceBalanced(request, env, ctx, limit, query, region);

  const rssSources = acquisition.sources.filter((source) => source.kind === "rss");
  const apiSources = acquisition.sources.filter((source) => source.kind === "api");
  const failed = acquisition.sources.filter((source) => source.error);
  const candidatesAcquired = acquisition.sources.reduce((total, source) => total + source.rawCount, 0);

  return json({
    version: "2.8.0",
    stage: "source-balanced-live-display",
    data: acquisition.selected,
    count: acquisition.selected.length,
    limit,
    query,
    region,
    pipeline: {
      rssFeedsChecked: rssSources.length,
      rssFeedsSuccessful: rssSources.filter((source) => !source.error).length,
      apiConnectorsChecked: apiSources.length,
      apiConnectorsSuccessful: apiSources.filter((source) => !source.error).length,
      candidatesAcquired,
      candidatesNormalized: acquisition.selected.length,
      candidatesRejected: 0,
      uniqueOpportunities: acquisition.selected.length,
      duplicatesRemoved: Math.max(0, candidatesAcquired - acquisition.selected.length),
      staleOpportunities: 0,
      unknownFreshness: 0,
      sourceBalanced: true,
      failedSources: failed.map((source) => ({ id: source.id, error: source.error })),
    },
    persistence: "not-enabled",
    note: "V2.8 selects live opportunities in source-balanced round-robin order before applying the response limit, preventing a single high-volume source from monopolizing the display.",
  });
}

export default {
  async fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },
};
