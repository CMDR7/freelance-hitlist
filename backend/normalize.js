const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "source",
]);

const STALE_AFTER_DAYS = 45;

export function cleanText(value = "") {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeText(value = "") {
  return cleanText(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function asArray(value) {
  if (Array.isArray(value)) return [...new Set(value.flatMap(asArray).map(cleanText).filter(Boolean))];
  if (value === null || value === undefined || value === "") return [];
  return [cleanText(value)].filter(Boolean);
}

export function canonicalizeUrl(value = "") {
  const raw = cleanText(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    [...url.searchParams.keys()].forEach((key) => {
      if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    });
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    url.pathname = url.pathname.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
    return url.toString();
  } catch {
    return raw.replace(/[?#].*$/, "");
  }
}

function parseDate(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function freshness(publishedAt, now = Date.now()) {
  if (!publishedAt) return "unknown";
  const age = now - Date.parse(publishedAt);
  if (!Number.isFinite(age) || age < 0) return "fresh";
  return age > STALE_AFTER_DAYS * 86400000 ? "stale" : "fresh";
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function deriveEmployer(candidate) {
  return cleanText(
    candidate.employer ||
    candidate.companyName ||
    candidate.company ||
    candidate.company_name ||
    candidate.employerName ||
    "Unknown employer",
  ) || "Unknown employer";
}

function deriveSourceName(candidate) {
  return cleanText(candidate.sourceName || candidate.feedName || candidate.source || candidate.sourceId || "Unknown source");
}

function deriveTags(candidate) {
  return asArray([
    candidate.tags,
    candidate.jobIndustry,
    candidate.jobLevel,
    candidate.category,
    candidate.jobCategory,
  ]);
}

function deriveEngagement(candidate) {
  return asArray([
    candidate.engagement,
    candidate.jobType,
    candidate.job_types,
    candidate.job_type,
    candidate.type,
  ]);
}

function deriveLocation(candidate) {
  const locations = asArray([
    candidate.location,
    candidate.jobGeo,
    candidate.job_geo,
    candidate.remote === true || String(candidate.remote).toLowerCase() === "true" ? "Remote" : null,
  ]);
  return locations.length ? locations : ["Unknown"];
}

function mergeArrays(...values) {
  return [...new Set(values.flatMap(asArray).filter(Boolean))];
}

function chooseText(primary, secondary, fallback = "") {
  return cleanText(primary) || cleanText(secondary) || fallback;
}

export async function normalizeCandidate(candidate, options = {}) {
  const retrievedAt = parseDate(candidate.retrievedAt) || new Date().toISOString();
  const url = canonicalizeUrl(candidate.url || candidate.link || "");
  const employer = deriveEmployer(candidate);
  const title = chooseText(candidate.title, candidate.jobTitle, "Untitled opportunity");
  const sourceId = cleanText(candidate.sourceId || candidate.source || "unknown-source");
  const sourceName = deriveSourceName(candidate);
  const publishedAt = parseDate(candidate.publishedAt || candidate.pubDate || candidate.published || candidate.created_at || candidate.createdAt);
  const updatedAt = parseDate(candidate.updatedAt || candidate.updated_at);
  const description = cleanText(candidate.description || candidate.jobDescription || candidate.jobExcerpt || "");
  const attribution = candidate.attribution || options.attribution || null;
  const feedIds = mergeArrays(candidate.feedId);
  const acquisitionTypes = mergeArrays(candidate.acquisition || "unknown");
  const sourceIds = [sourceId];
  const canonicalUrl = url || null;
  const semanticKey = employer !== "Unknown employer"
    ? [normalizeText(employer), normalizeText(title), normalizeText(deriveLocation(candidate).join(" "))].join("|")
    : null;
  const fingerprintInput = canonicalUrl
    ? `url|${canonicalUrl}`
    : `semantic|${semanticKey || `${sourceId}|${normalizeText(title)}`}`;
  const canonicalId = `opp-${(await sha256(fingerprintInput)).slice(0, 24)}`;

  return {
    id: canonicalId,
    canonicalId,
    sourceId,
    sourceName,
    employer,
    title,
    url: canonicalUrl || cleanText(candidate.url || candidate.link || ""),
    engagement: deriveEngagement(candidate),
    location: deriveLocation(candidate),
    tags: deriveTags(candidate),
    publishedAt,
    updatedAt,
    retrievedAt,
    status: candidate.status === "closed" ? "closed" : "active",
    freshness: freshness(publishedAt),
    description,
    notes: cleanText(candidate.notes || ""),
    attribution,
    acquisition: acquisitionTypes,
    stage: "normalized",
    provenance: {
      sourceIds,
      feedIds,
      acquisitionTypes,
    },
    duplicateCount: 1,
    duplicateOf: null,
    _dedupe: {
      canonicalUrl,
      semanticKey,
    },
  };
}

function mergeOpportunity(existing, incoming) {
  const preferred = existing.publishedAt && incoming.publishedAt
    ? Date.parse(existing.publishedAt) >= Date.parse(incoming.publishedAt) ? existing : incoming
    : existing.publishedAt ? existing : incoming;

  return {
    ...preferred,
    sourceId: existing.sourceId,
    sourceName: chooseText(existing.sourceName, incoming.sourceName, "Unknown source"),
    employer: chooseText(existing.employer, incoming.employer, "Unknown employer"),
    title: chooseText(existing.title, incoming.title, "Untitled opportunity"),
    url: chooseText(existing.url, incoming.url),
    engagement: mergeArrays(existing.engagement, incoming.engagement),
    location: mergeArrays(existing.location, incoming.location),
    tags: mergeArrays(existing.tags, incoming.tags),
    publishedAt: existing.publishedAt || incoming.publishedAt,
    updatedAt: incoming.updatedAt || existing.updatedAt,
    retrievedAt: incoming.retrievedAt || existing.retrievedAt,
    status: existing.status === "active" || incoming.status === "active" ? "active" : existing.status,
    freshness: existing.freshness === "fresh" || incoming.freshness === "fresh" ? "fresh" : existing.freshness,
    description: chooseText(existing.description, incoming.description),
    notes: chooseText(existing.notes, incoming.notes),
    attribution: existing.attribution || incoming.attribution || null,
    acquisition: mergeArrays(existing.acquisition, incoming.acquisition),
    stage: "normalized",
    provenance: {
      sourceIds: mergeArrays(existing.provenance?.sourceIds, incoming.provenance?.sourceIds),
      feedIds: mergeArrays(existing.provenance?.feedIds, incoming.provenance?.feedIds),
      acquisitionTypes: mergeArrays(existing.provenance?.acquisitionTypes, incoming.provenance?.acquisitionTypes),
    },
    duplicateCount: (existing.duplicateCount || 1) + (incoming.duplicateCount || 1),
    duplicateOf: null,
    _dedupe: existing._dedupe,
  };
}

export async function normalizeAndDeduplicate(candidates = []) {
  const normalized = await Promise.all(candidates.map((candidate) => normalizeCandidate(candidate)));
  const byUrl = new Map();
  const bySemantic = new Map();
  const output = [];
  let duplicatesRemoved = 0;

  for (const item of normalized) {
    const urlKey = item._dedupe.canonicalUrl;
    const semanticKey = item._dedupe.semanticKey;
    const existingIndex = urlKey && byUrl.has(urlKey)
      ? byUrl.get(urlKey)
      : semanticKey && bySemantic.has(semanticKey)
        ? bySemantic.get(semanticKey)
        : null;

    if (existingIndex !== null && existingIndex !== undefined) {
      output[existingIndex] = mergeOpportunity(output[existingIndex], item);
      duplicatesRemoved += 1;
      continue;
    }

    const index = output.length;
    output.push(item);
    if (urlKey) byUrl.set(urlKey, index);
    if (semanticKey) bySemantic.set(semanticKey, index);
  }

  const data = output.map(({ _dedupe, ...item }) => item);
  return {
    data,
    inputCount: candidates.length,
    normalizedCount: normalized.length,
    uniqueCount: data.length,
    duplicatesRemoved,
    staleCount: data.filter((item) => item.freshness === "stale").length,
    unknownFreshnessCount: data.filter((item) => item.freshness === "unknown").length,
  };
}
