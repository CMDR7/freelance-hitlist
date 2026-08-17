const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

const API_VERSION = "2.4.0";

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
      mode: "backend-scaffold",
      endpoints: [
        "/api/health",
        "/api/sources",
        "/api/opportunities",
        "/api/sync/status",
      ],
      dataSource: "static-seed",
      nextLayer: "RSS / publication ingestion",
    });
  }

  if (path === "/api/health") {
    return json({
      status: "healthy",
      apiVersion: API_VERSION,
      timestamp: new Date().toISOString(),
      storage: env?.DB ? "d1-configured" : "not-configured",
      ingestion: "not-enabled",
    });
  }

  if (path === "/api/sources") {
    return json({
      data: [],
      count: 0,
      status: "ready",
      message: "Source endpoint is ready for normalized source data. Live ingestion is not enabled in V2.4.",
    });
  }

  if (path === "/api/opportunities") {
    const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 100);
    const q = (url.searchParams.get("q") || "").trim();
    const region = (url.searchParams.get("region") || "").trim();
    const status = (url.searchParams.get("status") || "").trim();

    return json({
      data: [],
      count: 0,
      limit,
      query: q,
      region,
      status,
      statusCode: "READY_FOR_INGESTION",
      message: "Opportunity endpoint is ready for normalized opportunity data. RSS/API ingestion begins in V2.5/V2.6.",
    });
  }

  if (path === "/api/sync/status") {
    return json({
      status: "idle",
      lastRunAt: null,
      lastSuccessfulRunAt: null,
      sourcesChecked: 0,
      opportunitiesIngested: 0,
      opportunitiesUpdated: 0,
      opportunitiesRejected: 0,
      errorCount: 0,
      ingestionEnabled: false,
    });
  }

  return notFound(path);
}

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
};
