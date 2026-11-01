import * as cheerio from "cheerio";
import ipaddr from "ipaddr.js";

export function isPublicUrl(value: string): boolean {
  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return false;
    }

    // URL keeps the brackets on IPv6 hosts ("[::1]"); ipaddr.js only parses the bare form.
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

    // Check domain extensions / hostnames known to be internal/private
    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.endsWith(".lan") ||
      host === "metadata.google.internal"
    ) {
      return false;
    }

    // Try parsing as IP address (v4 or v6) using ipaddr.js
    if (ipaddr.isValid(host)) {
      let addr = ipaddr.parse(host);
      // ::ffff:127.0.0.1 would otherwise report "ipv4Mapped" and skip the IPv4 checks.
      if (addr.kind() === "ipv6" && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
        addr = (addr as ipaddr.IPv6).toIPv4Address();
      }
      const rangeName = addr.range() as string;

      // Block non-unicast or private IP ranges
      if (
        rangeName === "loopback" ||
        rangeName === "private" ||
        rangeName === "linkLocal" ||
        rangeName === "uniqueLocal" ||
        rangeName === "broadcast" ||
        rangeName === "carrierGradeNat" ||
        rangeName === "carrierNat" ||
        rangeName === "unspecified" ||
        rangeName === "reserved" ||
        rangeName === "multicast"
      ) {
        return false;
      }
    }

    // Block cloud metadata IP explicitly
    if (host === "169.254.169.254") {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

async function searchTavilyApi(query: string, limit = 4): Promise<string[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: limit,
        search_depth: "basic",
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data.results)) {
      return data.results
        .map((r: { url?: string }) => r.url)
        .filter((u: unknown): u is string => typeof u === "string");
    }
  } catch {
    // ignore fetch error
  }
  return [];
}

async function searchSerperApi(query: string, limit = 4): Promise<string[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: limit }),
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data.organic)) {
      return data.organic
        .map((r: { link?: string }) => r.link)
        .filter((u: unknown): u is string => typeof u === "string");
    }
  } catch {
    // ignore
  }
  return [];
}

async function searchDDGHtml(query: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html",
        },
        signal: AbortSignal.timeout(6000),
      }
    );

    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const urls: string[] = [];

    const isCodeQuery =
      /\b(code|github|git|repo|repository|npm|library|sdk|package|script|programming)\b/i.test(
        query
      );

    $(".result__url, .result__a, .result__snippet").each((_, el) => {
      const href = $(el).attr("href");
      if (href) {
        let cleanUrl = href;
        if (cleanUrl.includes("uddg=")) {
          try {
            const parsed = new URL("https://duckduckgo.com" + cleanUrl);
            const uddg = parsed.searchParams.get("uddg");
            if (uddg) cleanUrl = decodeURIComponent(uddg);
          } catch {
            // ignore
          }
        }
        if (
          cleanUrl.startsWith("http") &&
          !cleanUrl.includes("duckduckgo.com/y.js") &&
          !cleanUrl.includes("bing.com/aclick") &&
          !cleanUrl.includes("ad_domain=") &&
          (!cleanUrl.includes("github.com") || isCodeQuery) &&
          !urls.includes(cleanUrl)
        ) {
          urls.push(cleanUrl);
        }
      }
    });

    return urls;
  } catch {
    return [];
  }
}

async function searchDDGApi(query: string): Promise<string[]> {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) return [];
    const parsed = await res.json();
    const urls: string[] = [];
    if (parsed.AbstractURL) urls.push(parsed.AbstractURL);
    if (parsed.Results && Array.isArray(parsed.Results)) {
      for (const r of parsed.Results) {
        if (r.FirstURL) urls.push(r.FirstURL);
      }
    }
    if (parsed.RelatedTopics && Array.isArray(parsed.RelatedTopics)) {
      for (const t of parsed.RelatedTopics) {
        if (t.FirstURL) urls.push(t.FirstURL);
      }
    }
    return urls;
  } catch {
    return [];
  }
}

export const UNIVERS_CLIENT_ENTITIES: Record<
  string,
  {
    fullName: string;
    primaryDomain: string;
    directUrls?: string[];
    contextTerms: string[];
  }
> = {
  mtl: {
    fullName: "Modern Terminals Limited",
    primaryDomain: "modernterminals.com",
    directUrls: [
      "https://www.modernterminals.com/en/sustainability/corporate-governance/corporate-environmental-policy/12/8/",
      "https://www.modernterminals.com/en/sustainability/environment/green-terminal-model/10/12/",
      "https://www.modernterminals.com/en/sustainability/sustainability-reports/19/",
      "https://www.modernterminals.com/en/sustainability/",
    ],
    contextTerms: [
      "Modern Terminals Limited",
      "Modern Terminals Group",
      "modernterminals.com",
      "Kwai Tsing Container Terminals",
    ],
  },
  "modern terminals": {
    fullName: "Modern Terminals Limited",
    primaryDomain: "modernterminals.com",
    directUrls: [
      "https://www.modernterminals.com/en/sustainability/corporate-governance/corporate-environmental-policy/12/8/",
      "https://www.modernterminals.com/en/sustainability/environment/green-terminal-model/10/12/",
      "https://www.modernterminals.com/en/sustainability/sustainability-reports/19/",
      "https://www.modernterminals.com/en/sustainability/",
    ],
    contextTerms: [
      "Modern Terminals Limited",
      "Modern Terminals Group",
      "modernterminals.com",
    ],
  },
  hactl: {
    fullName: "Hong Kong Air Cargo Terminals",
    primaryDomain: "hactl.com",
    directUrls: [
      "https://www.hactl.com/en-us/sustainability",
      "https://www.hactl.com/en-us/about-hactl/green-superterminal",
    ],
    contextTerms: [
      "Hong Kong Air Cargo Terminals Limited",
      "HACTL SuperTerminal 1",
      "hactl.com",
    ],
  },
  hit: {
    fullName: "Hongkong International Terminals",
    primaryDomain: "hit.com.hk",
    directUrls: [
      "https://www.hit.com.hk/en/Sustainability.html",
      "https://www.hit.com.hk/en/Home.html",
    ],
    contextTerms: ["Hongkong International Terminals", "HIT Hutchison Ports"],
  },
  aahk: {
    fullName: "Airport Authority Hong Kong",
    primaryDomain: "hongkongairport.com",
    directUrls: [
      "https://www.hongkongairport.com/en/sustainability/",
      "https://www.hongkongairport.com/en/sustainability/sustainable-airport/carbon-management.page",
    ],
    contextTerms: ["Airport Authority Hong Kong", "HKIA", "Hong Kong Airport"],
  },
  hkia: {
    fullName: "Hong Kong International Airport",
    primaryDomain: "hongkongairport.com",
    directUrls: [
      "https://www.hongkongairport.com/en/sustainability/",
    ],
    contextTerms: ["Hong Kong International Airport", "Airport Authority"],
  },
  clp: {
    fullName: "CLP Power Hong Kong",
    primaryDomain: "clpgroup.com",
    directUrls: [
      "https://www.clpgroup.com/en/sustainability.html",
    ],
    contextTerms: ["CLP Power Hong Kong", "CLP Group energy"],
  },
  hec: {
    fullName: "Hongkong Electric Company",
    primaryDomain: "hkelectric.com",
    directUrls: [
      "https://www.hkelectric.com/en/sustainability",
    ],
    contextTerms: ["Hongkong Electric", "HK Electric"],
  },
  mtr: {
    fullName: "MTR Corporation",
    primaryDomain: "mtr.com.hk",
    directUrls: [
      "https://www.mtr.com.hk/en/corporate/sustainability/",
    ],
    contextTerms: ["MTR Corporation", "MTR Hong Kong"],
  },
  swire: {
    fullName: "Swire Properties",
    primaryDomain: "swireproperties.com",
    directUrls: [
      "https://www.swireproperties.com/en/sustainable-development/",
      "https://www.swireproperties.com/en/sustainable-development/sd-reports/",
    ],
    contextTerms: ["Swire Properties", "Swire Pacific sustainability"],
  },
  shkp: {
    fullName: "Sun Hung Kai Properties",
    primaryDomain: "shkp.com",
    directUrls: [
      "https://www.shkp.com/en-US/sustainability",
    ],
    contextTerms: ["Sun Hung Kai Properties", "SHKP"],
  },
  hld: {
    fullName: "Henderson Land Development",
    primaryDomain: "hld.com",
    directUrls: [
      "https://www.hld.com/en/sustainability/",
    ],
    contextTerms: ["Henderson Land Development", "Henderson Land"],
  },
  psa: {
    fullName: "PSA International",
    primaryDomain: "globalpsa.com",
    directUrls: [
      "https://www.globalpsa.com/sustainability/",
    ],
    contextTerms: ["PSA International port terminals", "PSA Corporation"],
  },
  "link reit": {
    fullName: "Link Real Estate Investment Trust",
    primaryDomain: "linkreit.com",
    directUrls: [
      "https://www.linkreit.com/en/sustainability/",
    ],
    contextTerms: ["Link REIT", "Link Asset Management"],
  },
};

async function searchWikipediaSources(
  query: string,
  limit = 3
): Promise<string[]> {
  // Clean query of operators and restrict to concise topic title
  let targetQuery = query
    .replace(/site:\S+/gi, "")
    .replace(/filetype:\S+/gi, "")
    .replace(/["’'()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const lower = targetQuery.toLowerCase();
  for (const [key, ent] of Object.entries(UNIVERS_CLIENT_ENTITIES)) {
    const pattern = new RegExp(`\\b${key}\\b`, "i");
    if (pattern.test(lower)) {
      targetQuery = ent.fullName;
      break;
    }
  }

  // If query is longer than 5 words, take the first 4 words for Wikipedia search
  const queryWords = targetQuery.split(/\s+/);
  if (queryWords.length > 5) {
    targetQuery = queryWords.slice(0, 4).join(" ");
  }

  try {
    const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      targetQuery
    )}&format=json&srlimit=${limit}`;

    const res = await fetch(apiUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return [];
    const parsed = await res.json();
    const searchResults = parsed.query?.search || [];
    return searchResults.map(
      (item: { title: string }) =>
        `https://en.wikipedia.org/wiki/${encodeURIComponent(
          item.title.replace(/ /g, "_")
        )}`
    );
  } catch {
    return [];
  }
}

function generateCandidateQueries(query: string): string[] {
  const candidates: string[] = [];
  // Normalize possessives like MTL's or HACTL's to MTL / HACTL
  const normalized = query.replace(/['’]s\b/gi, "");
  const clean = normalized.replace(/[^\w\s]/g, " ");

  // Check for Univers client / facility entity acronyms and inject high-yield domain queries
  const lowerQuery = normalized.toLowerCase();
  for (const [key, entity] of Object.entries(UNIVERS_CLIENT_ENTITIES)) {
    const pattern = new RegExp(`\\b${key}\\b`, "i");
    if (pattern.test(lowerQuery)) {
      const rest = normalized.replace(pattern, "").replace(/\s+/g, " ").trim();
      candidates.push(`"${entity.fullName}" sustainability report`);
      candidates.push(`"${entity.fullName}" energy electricity`);
      candidates.push(`"${entity.fullName}" decarbonization emissions`);
      candidates.push(`site:${entity.primaryDomain} sustainability`);
      candidates.push(`site:${entity.primaryDomain} energy OR electricity OR HVAC`);
      candidates.push(`site:${entity.primaryDomain} filetype:pdf`);
      if (rest) candidates.push(`"${entity.fullName}" ${rest}`.trim());
      break;
    }
  }

  // Clean keywords without conversational fillers
  const stopwords = new Set([
    "research", "find", "come", "up", "with", "a", "number", "for", "their",
    "and", "the", "of", "in", "to", "about", "give", "me", "tell", "what", "is", "how", "does",
    "do", "look", "into", "search", "investigate", "show", "can", "you", "please", "information", "on"
  ]);
  const words = clean
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stopwords.has(w.toLowerCase()));

  if (words.length > 0) {
    const fullClean = words.join(" ");
    candidates.push(fullClean);

    // If query has 3 or more keywords, also try the primary 2-word prefix (e.g. "MTL HVAC")
    if (words.length >= 3) {
      candidates.push(words.slice(0, 2).join(" "));
    }

    // Expand common technical/operational variations (e.g. HVAC -> energy / electricity)
    const lowerClean = fullClean.toLowerCase();
    if (lowerClean.includes("hvac")) {
      candidates.push(fullClean.replace(/hvac/gi, "energy"));
      candidates.push(fullClean.replace(/hvac/gi, "electricity"));
    }
    if (lowerClean.includes("consumption")) {
      candidates.push(fullClean.replace(/consumption/gi, "sustainability"));
      candidates.push(fullClean.replace(/consumption/gi, "reduction"));
    }
  }

  // Direct original query
  if (!candidates.includes(query)) {
    candidates.push(query);
  }

  return Array.from(new Set(candidates)).filter(Boolean);
}

const PAYWALLED_DOMAINS = [
  "sciencedirect.com",
  "springer.com",
  "wiley.com",
  "tandfonline.com",
  "ieeexplore.ieee.org",
  "cell.com",
  "thelancet.com",
  "nejm.org",
  "academic.oup.com",
];

async function searchOpenAlexSources(
  query: string,
  limit = 3
): Promise<string[]> {
  if (!query) return [];
  // Clean query of operators and restrict to 5 concise words
  const cleanQ = query
    .replace(/site:\S+/gi, "")
    .replace(/filetype:\S+/gi, "")
    .replace(/["’'()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleanQ) return [];
  const targetWords = cleanQ.split(/\s+/).slice(0, 5).join(" ");

  try {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(
      targetWords
    )}&per-page=${limit * 2}&sort=relevance_score:desc`;

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "ApprovedResearchAgent/1.0 (mailto:research-agent@example.com)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return [];
    const parsed = await res.json();
    const results = parsed.results || [];
    const urls: string[] = [];

    for (const r of results) {
      const targetUrl =
        r.open_access?.oa_url ||
        r.primary_location?.pdf_url ||
        r.primary_location?.landing_page_url ||
        r.doi;

      if (targetUrl && typeof targetUrl === "string") {
        const isPaywalled = PAYWALLED_DOMAINS.some((domain) =>
          targetUrl.toLowerCase().includes(domain)
        );
        if (!isPaywalled && !urls.includes(targetUrl)) {
          urls.push(targetUrl);
        }
      }
      if (urls.length >= limit) break;
    }

    return urls;
  } catch {
    return [];
  }
}

async function searchHackerNewsSources(
  query: string,
  limit = 3
): Promise<string[]> {
  if (!query) return [];
  try {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(
      query
    )}&tags=story&hitsPerPage=${limit}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return [];
    const parsed = await res.json();
    const hits = parsed.hits || [];
    const urls: string[] = [];

    const isCodeQuery =
      /\b(code|github|git|repo|repository|npm|library|sdk|package|script|programming)\b/i.test(
        query
      );

    for (const hit of hits) {
      const targetUrl =
        hit.url ||
        (hit.objectID ? `https://news.ycombinator.com/item?id=${hit.objectID}` : null);

      if (
        targetUrl &&
        typeof targetUrl === "string" &&
        (!targetUrl.includes("github.com") || isCodeQuery) &&
        (!targetUrl.includes("gitlab.com") || isCodeQuery) &&
        !urls.includes(targetUrl)
      ) {
        urls.push(targetUrl);
      }
    }

    return urls;
  } catch {
    return [];
  }
}

function rankAndFilterSources(
  urls: string[],
  query: string,
  matchedEntity?: { fullName: string; primaryDomain: string }
): string[] {
  const isCodeQuery =
    /\b(code|github|git|repo|repository|npm|library|sdk|package|script|programming)\b/i.test(
      query
    );

  const scored = urls
    .filter((url) => {
      const lower = url.toLowerCase();
      // Filter out code repositories unless explicit
      if ((lower.includes("github.com") || lower.includes("gitlab.com")) && !isCodeQuery) {
        return false;
      }
      // Filter out Montreal metro MR-73 train confusion
      if (lower.includes("mr-73") || lower.includes("montreal_metro")) {
        return false;
      }
      // Filter out internal/staging testing environments
      if (lower.includes("-uat.") || lower.includes(".uat.") || lower.includes("staging.")) {
        return false;
      }
      return true;
    })
    .map((url) => {
      let score = 0;
      const lower = url.toLowerCase();

      // Highest priority: official client domain
      if (matchedEntity && lower.includes(matchedEntity.primaryDomain.toLowerCase())) {
        score += 100;
      }

      // High priority: sustainability / ESG / annual reports & PDFs
      if (lower.endsWith(".pdf") || lower.includes(".pdf")) {
        score += 50;
      }
      if (
        lower.includes("sustainability") ||
        lower.includes("decarbon") ||
        lower.includes("esg")
      ) {
        score += 35;
      }
      if (
        lower.includes("energy") ||
        lower.includes("electricity") ||
        lower.includes("environment") ||
        lower.includes("hvac")
      ) {
        score += 25;
      }
      if (lower.includes("report") || lower.includes("annual")) {
        score += 20;
      }

      // Wikipedia is helpful for general structure, but secondary to primary disclosures
      if (lower.includes("wikipedia.org")) {
        score += 10;
      }

      // Academic repositories (OpenAlex)
      if (
        lower.includes("resolver.tudelft") ||
        lower.includes("doi.org") ||
        lower.includes("sciview") ||
        lower.includes("arxiv.org")
      ) {
        score += 15;
      }

      return { url, score };
    });

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  return Array.from(new Set(scored.map((s) => s.url)));
}

export async function searchWebSources(
  query: string,
  limit = 7
): Promise<string[]> {
  const urls: string[] = [];
  const candidateQueries = generateCandidateQueries(query);

  // Check if query matched any known Univers client entity
  const lowerQuery = query.toLowerCase();
  let matchedEntity:
    | (typeof UNIVERS_CLIENT_ENTITIES)[string]
    | undefined;
  for (const [key, entity] of Object.entries(UNIVERS_CLIENT_ENTITIES)) {
    if (new RegExp(`\\b${key}\\b`, "i").test(lowerQuery)) {
      matchedEntity = entity;
      break;
    }
  }

  // If matched client entity has verified direct URLs, seed them into the candidate pool
  if (matchedEntity && matchedEntity.directUrls) {
    for (const directUrl of matchedEntity.directUrls) {
      if (isPublicUrl(directUrl) && !urls.includes(directUrl)) {
        urls.push(directUrl);
      }
    }
  }

  for (const q of candidateQueries.slice(0, 3)) {
    if (urls.length >= limit) break;

    // 1. Tavily API (if configured with API key)
    const tavily = await searchTavilyApi(q, 4);
    for (const u of tavily) {
      if (isPublicUrl(u) && !urls.includes(u)) urls.push(u);
    }

    // 2. Serper API (if configured with API key)
    if (urls.length < limit) {
      const serper = await searchSerperApi(q, 4);
      for (const u of serper) {
        if (isPublicUrl(u) && !urls.includes(u)) urls.push(u);
      }
    }

    // 3. DuckDuckGo HTML Scraper (live web, client domains, PDF disclosures)
    if (urls.length < limit) {
      const ddgHtml = await searchDDGHtml(q);
      for (const u of ddgHtml) {
        if (isPublicUrl(u) && !urls.includes(u)) urls.push(u);
      }
    }

    // 4. DuckDuckGo API fallback
    if (urls.length < limit) {
      const ddgApi = await searchDDGApi(q);
      for (const u of ddgApi) {
        if (isPublicUrl(u) && !urls.includes(u)) urls.push(u);
      }
    }

    // 5. Wikipedia API (limit to 1 encyclopedic article)
    if (urls.length < limit) {
      const wiki = await searchWikipediaSources(q, 1);
      for (const u of wiki) {
        if (isPublicUrl(u) && !urls.includes(u)) urls.push(u);
      }
    }

    // 6. OpenAlex Scholarly API (limit to 1 academic paper if entity is matched)
    if (urls.length < limit) {
      const openAlex = await searchOpenAlexSources(q, matchedEntity ? 1 : 2);
      for (const u of openAlex) {
        if (isPublicUrl(u) && !urls.includes(u)) urls.push(u);
      }
    }
  }

  // Re-rank candidate URLs to prioritize client official domains, sustainability PDFs, and energy disclosures
  const ranked = rankAndFilterSources(urls, query, matchedEntity);
  return ranked.slice(0, limit);
}