const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

const API_VERSION = "2.6.0";

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
function tagValue(block, tags) { for (const tag of tags) { const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i")); if (m) return decodeXml(m[1].trim()); } return ""; }
function asArray(value) { if (Array.isArray(value)) return value.filter(Boolean).map(String); return value ? [String(value)] : []; }

function parseFeed(xml, feed) {
  const rss = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(m => m[1]);
  const atom = rss.length ? [] : [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].map(m => m[1]);
  return (rss.length ? rss : atom).map((block, index) => {
    const title = stripHtml(tagValue(block, ["title"])) || "Untitled opportunity";
    const description = stripHtml(tagValue(block, ["description", "content:encoded", "summary", "content"]));
    let link = tagValue(block, ["link", "guid"]);
    const href = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i); if (href) link = href[1];
    const publishedAt = tagValue(block, ["pubDate", "published", "updated", "dc:date"]);
    const guid = tagValue(block, ["guid", "id"]) || link || `${feed.id}-${index}`;
    return { id: `${feed.id}:${encodeURIComponent(guid).slice(0, 180)}`, feedId: feed.id, sourceId: feed.sourceId, sourceName: feed.name, title, url: link, description, publishedAt: publishedAt || null, retrievedAt: new Date().toISOString(), acquisition: "rss", stage: "ingested-candidate", attribution: feed.attribution };
  }).filter(item => item.url);
}

async function fetchFeed(feed) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(feed.url, { headers: { "User-Agent": "FL-HL-Intelligence-Network/2.6 (+public-feed-ingestion)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1" }, signal: controller.signal, redirect: "follow" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text(); if (!/<(?:rss|feed|rdf:RDF)\b/i.test(xml)) throw new Error("Response does not appear to be an RSS/Atom/XML feed");
    const items = parseFeed(xml, feed);
    return { feed, status: "healthy", fetchedAt: new Date().toISOString(), itemCount: items.length, items };
  } catch (error) { return { feed, status: "degraded", fetchedAt: new Date().toISOString(), itemCount: 0, items: [], error: error?.name === "AbortError" ? "Feed request timed out" : String(error?.message || error) }; }
  finally { clearTimeout(timeout); }
}
async function ingestFeeds(selectedFeedId = null) { const selected = selectedFeedId ? FEEDS.filter(f => f.id === selectedFeedId && f.enabled) : FEEDS.filter(f => f.enabled); const results = await Promise.all(selected.map(fetchFeed)); return { results, items: results.flatMap(r => r.items), checked: results.length, successful: results.filter(r => r.status === "healthy").length }; }

function normalizeJobicy(job, retrievedAt) {
  return { id: `jobicy-${job.id}`, sourceId: "jobicy", title: job.jobTitle || "Untitled opportunity", employer: job.companyName || "Unknown employer", url: job.url, engagement: asArray(job.jobType), location: asArray(job.jobGeo || "Remote"), tags: [...asArray(job.jobIndustry), job.jobLevel].filter(Boolean), publishedAt: job.pubDate || null, updatedAt: null, retrievedAt, status: "active", description: stripHtml(job.jobExcerpt || job.jobDescription || ""), attribution: CONNECTORS.jobicy.attribution, acquisition: "api", stage: "ingested-candidate" };
}
function normalizeArbeitnow(job, retrievedAt) {
  const remote = job.remote === true || String(job.remote).toLowerCase() === "true";
  return { id: `arbeitnow-${job.slug || job.id || encodeURIComponent(job.url || job.title || crypto.randomUUID())}`, sourceId: "arbeitnow", title: job.title || "Untitled opportunity", employer: job.company_name || job.company || "Unknown employer", url: job.url, engagement: asArray(job.job_types || job.job_type || job.type), location: [remote ? "Remote" : null, job.location].filter(Boolean), tags: asArray(job.tags || job.category), publishedAt: job.created_at || job.published_at || null, updatedAt: null, retrievedAt, status: "active", description: stripHtml(job.description || ""), attribution: CONNECTORS.arbeitnow.attribution, acquisition: "api", stage: "ingested-candidate" };
}
async function fetchConnector(name) {
  const connector = CONNECTORS[name]; if (!connector) throw new Error(`Unknown connector: ${name}`);
  const retrievedAt = new Date().toISOString();
  const response = await fetch(connector.url, { headers: { Accept: "application/json", "User-Agent": "FL-HL-Intelligence-Network/2.6" } });
  if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}`);
  const payload = await response.json(); const jobs = Array.isArray(payload.jobs) ? payload.jobs : Array.isArray(payload.data) ? payload.data : [];
  const data = name === "jobicy" ? jobs.map(j => normalizeJobicy(j, retrievedAt)).filter(j => j.url) : jobs.map(j => normalizeArbeitnow(j, retrievedAt)).filter(j => j.url);
  return { connector: connector.id, source: name, retrievedAt, count: data.length, stage: "ingested-candidate", data };
}

async function handleRequest(request, env) {
  const url = new URL(request.url); const path = url.pathname.replace(/\/+$/, "") || "/";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED", message: "This API currently accepts GET and OPTIONS requests only." }, 405, { Allow: "GET, OPTIONS" });

  if (path === "/" || path === "/api") return json({ name: "FL-HL // Intelligence API", version: API_VERSION, status: "operational", mode: "rss-and-api-ingestion", endpoints: ["/api/health", "/api/feeds", "/api/connectors", "/api/ingest/rss", "/api/ingest/api?connector=jobicy", "/api/ingest/api?connector=arbeitnow", "/api/sources", "/api/opportunities", "/api/sync/status"], dataSource: "public-rss-and-free-apis", nextLayer: "normalization + deduplication" });
  if (path === "/api/health") return json({ status: "healthy", apiVersion: API_VERSION, timestamp: new Date().toISOString(), storage: env?.DB ? "d1-configured" : "not-configured", ingestion: "on-demand", rssFeeds: FEEDS.length, apiConnectors: Object.keys(CONNECTORS).length });
  if (path === "/api/feeds") return json({ version: API_VERSION, data: FEEDS, count: FEEDS.length });
  if (path === "/api/connectors") return json({ version: API_VERSION, data: Object.values(CONNECTORS).map(({ id, name, url, attribution }) => ({ id, name, url, authentication: "none", attribution })), count: Object.keys(CONNECTORS).length });

  if (path === "/api/ingest/rss") {
    const feedId = (url.searchParams.get("feed") || "").trim(); if (feedId && !FEEDS.some(f => f.id === feedId)) return json({ error: "UNKNOWN_FEED", feed: feedId }, 404);
    const ingestion = await ingestFeeds(feedId || null);
    return json({ version: API_VERSION, stage: "ingested-candidate", checked: ingestion.checked, successful: ingestion.successful, itemCount: ingestion.items.length, results: ingestion.results.map(r => ({ feedId: r.feed.id, name: r.feed.name, status: r.status, fetchedAt: r.fetchedAt, itemCount: r.itemCount, error: r.error || null })), data: ingestion.items });
  }

  if (path === "/api/ingest/api") {
    const connector = (url.searchParams.get("connector") || "").trim().toLowerCase(); if (!connector) return json({ error: "CONNECTOR_REQUIRED", available: Object.keys(CONNECTORS) }, 400);
    try { return json(await fetchConnector(connector)); } catch (error) { return json({ error: "CONNECTOR_FAILED", connector, message: error instanceof Error ? error.message : String(error) }, 502); }
  }

  if (path === "/api/sources") return json({ data: [], count: 0, status: "ready", message: "Curated source persistence begins after normalization and deduplication." });
  if (path === "/api/opportunities") return json({ data: [], count: 0, statusCode: "READY_FOR_NORMALIZATION", message: "Live candidates are available through the ingestion routes. V2.7 will normalize, deduplicate, and persist them." });
  if (path === "/api/sync/status") return json({ status: "manual-ingestion", lastRunAt: null, lastSuccessfulRunAt: null, sourcesChecked: FEEDS.length + Object.keys(CONNECTORS).length, opportunitiesIngested: 0, opportunitiesUpdated: 0, opportunitiesRejected: 0, errorCount: 0, ingestionEnabled: true, schedulerEnabled: false });
  return notFound(path);
}

export default { async fetch(request, env, ctx) { return handleRequest(request, env, ctx); } };
