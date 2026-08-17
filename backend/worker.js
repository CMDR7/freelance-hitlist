import { normalizeAndDeduplicate } from "./normalize.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

const API_VERSION = "2.7.0";

const FEEDS = [
  { id: "remote-first-jobs-ai", sourceId: "remote-first-jobs", type: "rss", name: "Remote First Jobs // AI", url: "https://remotefirstjobs.com/rss/jobs/ai.rss", enabled: true, attribution: { required: true, label: "Source: Remote First Jobs", url: "https://remotefirstjobs.com/" } },
  { id: "jobicy-ai", sourceId: "jobicy", type: "rss", name: "Jobicy // AI Remote Jobs", url: "https://jobicy.com/jobs/feed?tag=ai", enabled: true, attribution: { required: true, label: "Source: Jobicy", url: "https://jobicy.com/" } },
  { id: "remoteyeah-engineering", sourceId: "remoteyeah", type: "rss", name: "RemoteYeah // Engineering", url: "https://remoteyeah.com/rss.xml", enabled: true, attribution: { required: false, label: "Source: RemoteYeah", url: "https://remoteyeah.com/" } },
  { id: "weworkremotely-programming", sourceId: "we-work-remotely", type: "rss", name: "We Work Remotely // Programming", url: "https://weworkremotely.com/categories/remote-programming-jobs.rss", enabled: true, attribution: { required: true, label: "Source: We Work Remotely", url: "https://weworkremotely.com/" } },
];

const CONNECTORS = {
  jobicy: {
    id: "jobicy-public-api",
    name: "Jobicy Public Jobs API",
    url: "https://jobicy.com/api/v2/remote-jobs?count=100&tag=ai",
    attribution: { required: true, label: "Source: Jobicy", url: "https://jobicy.com/" },
  },
  arbeitnow: {
    id: "arbeitnow-public-api",
    name: "Arbeitnow Free Job Board API",
    url: "https://www.arbeitnow.com/api/job-board-api",
    attribution: { required: false, label: "Source: Arbeitnow", url: "https://www.arbeitnow.com/" },
  },
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS, ...extraHeaders } });
}
function notFound(path) { return json({ error: "NOT_FOUND", path, message: "FL-HL Intelligence API route not found." }, 404); }
function decodeXml(value = "") { return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">" ).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))); }
function stripHtml(value = "") { return decodeXml(value).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function tagValue(block, tags) { for (const tag of tags) { const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i")); if (match) return decodeXml(match[1].trim()); } return ""; }
function asArray(value) { if (Array.isArray(value)) return value.filter(Boolean).map(String); return value ? [String(value)] : []; }

function parseFeed(xml, feed) {
  const rss = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  const atom = rss.length ? [] : [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].map((match) => match[1]);
  return (rss.length ? rss : atom).map((block, index) => {
    const title = stripHtml(tagValue(block, ["title"])) || "Untitled opportunity";
    const description = stripHtml(tagValue(block, ["description", "content:encoded", "summary", "content"]));
    let link = tagValue(block, ["link", "guid"]);
    const href = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i); if (href) link = href[1];
    const publishedAt = tagValue(block, ["pubDate", "published", "updated", "dc:date"]);
    const guid = tagValue(block, ["guid", "id"]) || link || `${feed.id}-${index}`;
    return { id: `${feed.id}:${encodeURIComponent(guid).slice(0, 180)}`, feedId: feed.id, sourceId: feed.sourceId, sourceName: feed.name, title, url: link, description, publishedAt: publishedAt || null, retrievedAt: new Date().toISOString(), acquisition: feed.type, stage: "ingested-candidate", attribution: feed.attribution };
  }).filter((item) => item.url);
}

async function fetchFeed(feed) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(feed.url, { headers: { "User-Agent": "FL-HL-Intelligence-Network/2.7 (+public-feed-ingestion)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1" }, signal: controller.signal, redirect: "follow" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text(); if (!/<(?:rss|feed|rdf:RDF)\b/i.test(xml)) throw new Error("Response does not appear to be an RSS/Atom/XML feed");
    const items = parseFeed(xml, feed);
    return { feed, status: "healthy", fetchedAt: new Date().toISOString(), itemCount: items.length, items };
  } catch (error) { return { feed, status: "degraded", fetchedAt: new Date().toISOString(), itemCount: 0, items: [], error: error?.name === "AbortError" ? "Feed request timed out" : String(error?.message || error) }; }
  finally { clearTimeout(timeout); }
}
async function ingestFeeds(selectedFeedId = null) { const selected = selectedFeedId ? FEEDS.filter((feed) => feed.id === selectedFeedId && feed.enabled) : FEEDS.filter((feed) => feed.enabled); const results = await Promise.all(selected.map(fetchFeed)); return { results, items: results.flatMap((result) => result.items), checked: results.length, successful: results.filter((result) => result.status === "healthy").length }; }

function normalizeJobicy(job, retrievedAt) {
  return { sourceId: "jobicy", sourceName: "Jobicy Public Jobs API", title: job.jobTitle || "Untitled opportunity", employer: job.companyName || "Unknown employer", url: job.url, engagement: asArray(job.jobType), location: asArray(job.jobGeo || "Remote"), tags: [...asArray(job.jobIndustry), job.jobLevel].filter(Boolean), publishedAt: job.pubDate || null, retrievedAt, status: "active", description: stripHtml(job.jobExcerpt || job.jobDescription || ""), attribution: CONNECTORS.jobicy.attribution, acquisition: "api", stage: "ingested-candidate" };
}
function normalizeArbeitnow(job, retrievedAt) {
  const remote = job.remote === true || String(job.remote).toLowerCase() === "true";
  return { sourceId: "arbeitnow", sourceName: "Arbeitnow Free Job Board API", title: job.title || "Untitled opportunity", employer: job.company_name || job.company || "Unknown employer", url: job.url, engagement: asArray(job.job_types || job.job_type || job.type), location: [remote ? "Remote" : null, job.location].filter(Boolean), tags: asArray(job.tags || job.category), publishedAt: job.created_at || job.published_at || null, retrievedAt, status: "active", description: stripHtml(job.description || ""), attribution: CONNECTORS.arbeitnow.attribution, acquisition: "api", stage: "ingested-candidate" };
}
async function fetchConnector(name) {
  const connector = CONNECTORS[name]; if (!connector) throw new Error(`Unknown connector: ${name}`);
  const retrievedAt = new Date().toISOString();
  const response = await fetch(connector.url, { headers: { Accept: "application/json", "User-Agent": "FL-HL-Intelligence-Network/2.7" } });
  if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}`);
  const payload = await response.json(); const jobs = Array.isArray(payload.jobs) ? payload.jobs : Array.isArray(payload.data) ? payload.data : [];
  const data = name === "jobicy" ? jobs.map((job) => normalizeJobicy(job, retrievedAt)).filter((job) => job.url) : jobs.map((job) => normalizeArbeitnow(job, retrievedAt)).filter((job) => job.url);
  return { connector: connector.id, source: name, retrievedAt, count: data.length, stage: "ingested-candidate", data };
}
async function acquireAll() {
  const rss = await ingestFeeds();
  const apiResults = await Promise.allSettled(Object.keys(CONNECTORS).map(fetchConnector));
  const api = apiResults.map((result, index) => result.status === "fulfilled" ? result.value : { connector: CONNECTORS[Object.keys(CONNECTORS)[index]].id, source: Object.keys(CONNECTORS)[index], retrievedAt: new Date().toISOString(), count: 0, stage: "ingested-candidate", data: [], error: String(result.reason?.message || result.reason) });
  return { candidates: [...rss.items, ...api.flatMap((result) => result.data)], rss, api };
}

async function handleRequest(request, env) {
  const url = new URL(request.url); const path = url.pathname.replace(/\/+$/, "") || "/";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED", message: "This API currently accepts GET and OPTIONS requests only." }, 405, { Allow: "GET, OPTIONS" });

  if (path === "/" || path === "/api") return json({ name: "FL-HL // Intelligence API", version: API_VERSION, status: "operational", mode: "normalized-ingestion", endpoints: ["/api/health", "/api/feeds", "/api/connectors", "/api/ingest/rss", "/api/ingest/api?connector=jobicy", "/api/ingest/api?connector=arbeitnow", "/api/opportunities?live=true", "/api/sources", "/api/sync/status"], dataSource: "public-rss-and-free-apis", nextLayer: "live opportunity display" });
  if (path === "/api/health") return json({ status: "healthy", apiVersion: API_VERSION, timestamp: new Date().toISOString(), storage: env?.DB ? "d1-configured" : "not-configured", ingestion: "on-demand", normalization: "enabled", deduplication: "enabled", rssFeeds: FEEDS.length, apiConnectors: Object.keys(CONNECTORS).length });
  if (path === "/api/feeds") return json({ version: API_VERSION, data: FEEDS, count: FEEDS.length });
  if (path === "/api/connectors") return json({ version: API_VERSION, data: Object.values(CONNECTORS).map(({ id, name, url, attribution }) => ({ id, name, url, authentication: "none", attribution })), count: Object.keys(CONNECTORS).length });

  if (path === "/api/ingest/rss") {
    const feedId = (url.searchParams.get("feed") || "").trim(); if (feedId && !FEEDS.some((feed) => feed.id === feedId)) return json({ error: "UNKNOWN_FEED", feed: feedId }, 404);
    const ingestion = await ingestFeeds(feedId || null);
    return json({ version: API_VERSION, stage: "ingested-candidate", checked: ingestion.checked, successful: ingestion.successful, itemCount: ingestion.items.length, results: ingestion.results.map((result) => ({ feedId: result.feed.id, name: result.feed.name, status: result.status, fetchedAt: result.fetchedAt, itemCount: result.itemCount, error: result.error || null })), data: ingestion.items });
  }
  if (path === "/api/ingest/api") {
    const connector = (url.searchParams.get("connector") || "").trim().toLowerCase(); if (!connector) return json({ error: "CONNECTOR_REQUIRED", available: Object.keys(CONNECTORS) }, 400);
    try { return json(await fetchConnector(connector)); } catch (error) { return json({ error: "CONNECTOR_FAILED", connector, message: error instanceof Error ? error.message : String(error) }, 502); }
  }

  if (path === "/api/opportunities") {
    const live = ["1", "true", "yes"].includes((url.searchParams.get("live") || "").toLowerCase());
    const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 100);
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const region = (url.searchParams.get("region") || "").trim().toLowerCase();
    if (!live) return json({ data: [], count: 0, limit, query: q, region, statusCode: "READY_FOR_LIVE_DISPLAY", message: "Use live=true to acquire, normalize, and deduplicate current candidates in V2.7." });

    const acquisition = await acquireAll();
    const normalized = await normalizeAndDeduplicate(acquisition.candidates);
    const filtered = normalized.data.filter((item) => {
      const haystack = `${item.title} ${item.employer} ${item.description} ${item.sourceName} ${item.tags.join(" ")} ${item.location.join(" ")}`.toLowerCase();
      return (!q || haystack.includes(q)) && (!region || haystack.includes(region));
    }).slice(0, limit);

    return json({ version: API_VERSION, stage: "normalized", data: filtered, count: filtered.length, limit, query: q, region,
      pipeline: {
        rssFeedsChecked: acquisition.rss.checked,
        rssFeedsSuccessful: acquisition.rss.successful,
        apiConnectorsChecked: acquisition.api.length,
        apiConnectorsSuccessful: acquisition.api.filter((result) => !result.error).length,
        candidatesAcquired: normalized.inputCount,
        candidatesNormalized: normalized.normalizedCount,
        candidatesRejected: normalized.rejectedCount,
        uniqueOpportunities: normalized.uniqueCount,
        duplicatesRemoved: normalized.duplicatesRemoved,
        staleOpportunities: normalized.staleCount,
        unknownFreshness: normalized.unknownFreshnessCount,
      },
      persistence: "not-enabled",
      note: "V2.7 normalizes and deduplicates live candidates in-memory. Persistence and scheduled synchronization remain later stages.",
    });
  }
  if (path === "/api/sources") return json({ data: [], count: 0, status: "ready", message: "Curated source persistence begins after normalization and deduplication." });
  if (path === "/api/sync/status") return json({ status: "manual-ingestion", lastRunAt: null, lastSuccessfulRunAt: null, sourcesChecked: FEEDS.length + Object.keys(CONNECTORS).length, opportunitiesIngested: 0, opportunitiesUpdated: 0, opportunitiesRejected: 0, errorCount: 0, ingestionEnabled: true, normalizationEnabled: true, deduplicationEnabled: true, schedulerEnabled: false, persistenceEnabled: false });
  return notFound(path);
}

export default { async fetch(request, env, ctx) { return handleRequest(request, env, ctx); } };
