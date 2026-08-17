const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

const API_VERSION = "2.5.0";

const FEEDS = [
  {
    id: "remotefirst-ai",
    sourceId: "remotefirstjobs",
    type: "rss",
    name: "Remote First Jobs // AI",
    url: "https://remotefirstjobs.com/rss/jobs/ai.rss",
    enabled: true,
    credit: "Remote First Jobs",
  },
  {
    id: "jobicy-ai",
    sourceId: "jobicy",
    type: "rss",
    name: "Jobicy // AI Remote Jobs",
    url: "https://jobicy.com/feed/job_feed?search_keywords=AI",
    enabled: true,
    credit: "Jobicy",
  },
  {
    id: "remoteyeah-ai-native",
    sourceId: "remoteyeah",
    type: "rss",
    name: "RemoteYeah // AI-native Engineering",
    url: "https://remoteyeah.com/rss.xml",
    enabled: true,
    credit: "RemoteYeah",
  },
  {
    id: "weworkremotely-programming",
    sourceId: "weworkremotely",
    type: "rss",
    name: "We Work Remotely // Programming",
    url: "https://weworkremotely.com/categories/remote-programming-jobs.rss",
    enabled: true,
    credit: "We Work Remotely",
  },
];

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function notFound(path) {
  return json({
    error: "NOT_FOUND",
    path,
    message: "FL-HL Intelligence API route not found.",
  }, 404);
}

function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripHtml(value = "") {
  return decodeXml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tagValue(block, tagNames) {
  for (const tag of tagNames) {
    const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
    const match = block.match(pattern);
    if (match) return decodeXml(match[1].trim());
  }
  return "";
}

function parseFeed(xml, feed) {
  const rssBlocks = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  const atomBlocks = rssBlocks.length ? [] : [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].map((m) => m[1]);
  const blocks = rssBlocks.length ? rssBlocks : atomBlocks;

  return blocks.map((block, index) => {
    const title = stripHtml(tagValue(block, ["title"])) || "Untitled opportunity";
    const description = stripHtml(tagValue(block, ["description", "content:encoded", "summary", "content"]));
    let link = tagValue(block, ["link", "guid"]);
    const href = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
    if (href) link = href[1];
    const publishedAt = tagValue(block, ["pubDate", "published", "updated", "dc:date"]);
    const guid = tagValue(block, ["guid", "id"]) || link || `${feed.id}-${index}`;

    return {
      id: `${feed.id}:${encodeURIComponent(guid).slice(0, 180)}`,
      feedId: feed.id,
      sourceId: feed.sourceId,
      sourceName: feed.credit,
      title,
      url: link,
      description,
      publishedAt: publishedAt || null,
      retrievedAt: new Date().toISOString(),
      acquisition: "rss",
      stage: "ingested-candidate",
    };
  }).filter((item) => item.url);
}

async function fetchFeed(feed) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(feed.url, {
      headers: {
        "User-Agent": "FL-HL-Intelligence-Network/2.5 (+public-feed-ingestion)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const xml = await response.text();
    if (!/<(?:rss|feed|rdf:RDF)\b/i.test(xml)) {
      throw new Error("Response does not appear to be an RSS/Atom/XML feed");
    }

    const items = parseFeed(xml, feed);
    return {
      feed,
      status: "healthy",
      fetchedAt: new Date().toISOString(),
      itemCount: items.length,
      items,
    };
  } catch (error) {
    return {
      feed,
      status: "degraded",
      fetchedAt: new Date().toISOString(),
      itemCount: 0,
      items: [],
      error: error?.name === "AbortError" ? "Feed request timed out" : String(error?.message || error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function ingestFeeds(selectedFeedId = null) {
  const selected = selectedFeedId
    ? FEEDS.filter((feed) => feed.id === selectedFeedId && feed.enabled)
    : FEEDS.filter((feed) => feed.enabled);

  const results = await Promise.all(selected.map(fetchFeed));
  return {
    results,
    items: results.flatMap((result) => result.items),
    checked: results.length,
    successful: results.filter((result) => result.status === "healthy").length,
  };
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== "GET") {
    return json({
      error: "METHOD_NOT_ALLOWED",
      message: "This API currently accepts GET and OPTIONS requests only.",
    }, 405, { Allow: "GET, OPTIONS" });
  }

  if (path === "/" || path === "/api") {
    return json({
      name: "FL-HL // Intelligence API",
      version: API_VERSION,
      status: "operational",
      mode: "rss-ingestion",
      endpoints: [
        "/api/health",
        "/api/feeds",
        "/api/ingest/rss",
        "/api/sources",
        "/api/opportunities",
        "/api/sync/status",
      ],
      dataSource: "public-rss-feeds",
      nextLayer: "free API connectors",
    });
  }

  if (path === "/api/health") {
    return json({
      status: "healthy",
      apiVersion: API_VERSION,
      timestamp: new Date().toISOString(),
      storage: env?.DB ? "d1-configured" : "not-configured",
      ingestion: "rss-enabled",
      configuredFeeds: FEEDS.filter((feed) => feed.enabled).length,
    });
  }

  if (path === "/api/feeds") {
    return json({
      version: "2.5.0",
      data: FEEDS.map(({ id, sourceId, type, name, url, enabled, credit }) => ({ id, sourceId, type, name, url, enabled, credit })),
      count: FEEDS.length,
    });
  }

  if (path === "/api/ingest/rss") {
    const feedId = (url.searchParams.get("feed") || "").trim();
    if (feedId && !FEEDS.some((feed) => feed.id === feedId)) {
      return json({ error: "UNKNOWN_FEED", feed: feedId }, 404);
    }

    const ingestion = await ingestFeeds(feedId || null);
    return json({
      version: API_VERSION,
      stage: "ingested-candidate",
      checked: ingestion.checked,
      successful: ingestion.successful,
      itemCount: ingestion.items.length,
      results: ingestion.results.map((result) => ({
        feedId: result.feed.id,
        name: result.feed.name,
        status: result.status,
        fetchedAt: result.fetchedAt,
        itemCount: result.itemCount,
        error: result.error || null,
      })),
      data: ingestion.items,
      note: "RSS items are ingested candidates in V2.5. Normalization, deduplication, persistence, and curated-source promotion are later pipeline stages.",
    });
  }

  if (path === "/api/sources") {
    return json({
      data: [],
      count: 0,
      status: "ready",
      message: "Curated source persistence begins after RSS ingestion validation.",
    });
  }

  if (path === "/api/opportunities") {
    const live = ["1", "true", "yes"].includes((url.searchParams.get("live") || "").toLowerCase());
    const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 100);
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const region = (url.searchParams.get("region") || "").trim().toLowerCase();

    if (!live) {
      return json({
        data: [],
        count: 0,
        limit,
        query: q,
        region,
        statusCode: "READY_FOR_INGESTION",
        message: "Use live=true to inspect current RSS candidates in V2.5.",
      });
    }

    const ingestion = await ingestFeeds();
    const filtered = ingestion.items.filter((item) => {
      const haystack = `${item.title} ${item.description} ${item.sourceName}`.toLowerCase();
      const matchesQuery = !q || haystack.includes(q);
      const matchesRegion = !region || haystack.includes(region);
      return matchesQuery && matchesRegion;
    }).slice(0, limit);

    return json({
      data: filtered,
      count: filtered.length,
      limit,
      query: q,
      region,
      stage: "ingested-candidate",
      checkedFeeds: ingestion.checked,
      successfulFeeds: ingestion.successful,
    });
  }

  if (path === "/api/sync/status") {
    return json({
      status: "manual-rss-ingestion",
      lastRunAt: null,
      lastSuccessfulRunAt: null,
      sourcesChecked: FEEDS.length,
      opportunitiesIngested: 0,
      opportunitiesUpdated: 0,
      opportunitiesRejected: 0,
      errorCount: 0,
      ingestionEnabled: true,
      schedulerEnabled: false,
      note: "V2.5 supports on-demand RSS ingestion. Scheduled ingestion and persistence are introduced after validation.",
    });
  }

  return notFound(path);
}

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
};
