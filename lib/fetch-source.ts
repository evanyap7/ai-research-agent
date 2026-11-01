import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { isPublicUrl } from "./sources";

const MAX_CHARS_PER_SOURCE = 30_000;
const FETCH_TIMEOUT_MS = 6_000;

export type SourcePacket = {
  id: string;
  title: string;
  url: string;
  text: string;
};

const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// Configure Turndown rules to strip noise elements cleanly
turndownService.remove(["script", "style", "noscript", "iframe", "svg", "nav", "footer"]);

async function parsePdfBuffer(buffer: Buffer): Promise<string> {
  try {
    if (typeof globalThis.DOMMatrix === "undefined") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).DOMMatrix = class DOMMatrix {};
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFParse } = require("pdf-parse");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path");

    const pdfOptions: Record<string, unknown> = { first: 20 };
    try {
      const pdfjsDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
      pdfOptions.cMapUrl = path.join(pdfjsDir, "cmaps") + "/";
      pdfOptions.cMapPacked = true;
      pdfOptions.standardFontDataUrl = path.join(pdfjsDir, "standard_fonts") + "/";
    } catch {
      // fallback without cmaps
    }

    const uint8 = new Uint8Array(buffer);
    const p = new PDFParse(uint8, pdfOptions);
    await p.load();
    const res = await p.getText();
    return (res.text || String(res)).replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

async function fetchBufferWithTimeout(
  targetUrl: string,
  redirectCount = 0
): Promise<{ status: number; contentType: string; buffer: Buffer }> {
  if (redirectCount > 5) {
    throw new Error("Too many redirects");
  }

  let safeUrl = targetUrl;
  try {
    safeUrl = encodeURI(decodeURI(targetUrl));
  } catch {
    safeUrl = targetUrl;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(safeUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeoutId);

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get("content-type") || "";

    return {
      status: response.status,
      contentType,
      buffer,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Timeout fetching ${targetUrl}`);
    }
    throw error;
  }
}

async function fetchViaJinaReader(
  targetUrl: string
): Promise<{ title: string; text: string } | null> {
  try {
    let safeTarget = targetUrl;
    try {
      safeTarget = encodeURI(decodeURI(targetUrl));
    } catch {
      safeTarget = targetUrl;
    }
    const jinaUrl = `https://r.jina.ai/${safeTarget}`;
    const res = await fetch(jinaUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/plain",
      },
      signal: AbortSignal.timeout(9000),
    });

    const body = await res.text();
    // Jina Reader sometimes preserves origin status 403 but returns full parsed markdown
    if (!body || body.length < 150) return null;
    if (
      body.includes("Please confirm you are a human") ||
      body.includes("Checking your browser") ||
      body.includes("Client Challenge")
    ) {
      return null;
    }

    let title = "Web Source";
    const titleMatch = body.match(/^Title:\s*(.+)$/m);
    if (titleMatch && titleMatch[1]) {
      title = titleMatch[1].trim();
    }

    return { title, text: body.slice(0, MAX_CHARS_PER_SOURCE) };
  } catch {
    return null;
  }
}

function isChallengePage(text: string, title = ""): boolean {
  const combined = (title + " " + text).toLowerCase();
  return (
    combined.includes("checking your browser") ||
    combined.includes("client challenge") ||
    combined.includes("cloudflare ray id") ||
    combined.includes("please verify you are a human") ||
    combined.includes("enable javascript and cookies") ||
    combined.includes("just a moment...") ||
    combined.includes("are you a robot?") ||
    combined.includes("ddos protection by cloudflare") ||
    combined.includes("a required part of this site couldn’t load") ||
    combined.includes("a required part of this site couldn't load") ||
    combined.includes("security check to access")
  );
}

export async function fetchSource(
  url: string,
  id: string
): Promise<SourcePacket> {
  if (!isPublicUrl(url)) {
    throw new Error("This URL is not from an approved source.");
  }

  let status = 0;
  let contentType = "";
  let buffer: Buffer | null = null;

  try {
    const result = await fetchBufferWithTimeout(url);
    status = result.status;
    contentType = result.contentType;
    buffer = result.buffer;
  } catch (error) {
    // If direct fetch fails (e.g. 403 or network issue), attempt Jina Reader fallback
    const jinaFallback = await fetchViaJinaReader(url);
    if (jinaFallback && !isChallengePage(jinaFallback.text, jinaFallback.title)) {
      return { id, title: jinaFallback.title, url, text: jinaFallback.text };
    }
    throw error;
  }

  if (status < 200 || status >= 300) {
    const jinaFallback = await fetchViaJinaReader(url);
    if (jinaFallback && !isChallengePage(jinaFallback.text, jinaFallback.title)) {
      return { id, title: jinaFallback.title, url, text: jinaFallback.text };
    }
    throw new Error(`Could not retrieve source (${url}): ${status}`);
  }

  let title = "Web Source";
  let text = "";

  // Handle PDF files directly
  if (
    contentType.includes("application/pdf") ||
    url.toLowerCase().endsWith(".pdf")
  ) {
    title = `PDF Document (${url.split("/").pop() || "Report"})`;
    text = await parsePdfBuffer(buffer!);
  } else {
    // Handle HTML pages
    const html = buffer!.toString("utf8");
    const $ = cheerio.load(html);

    // Extract attached PDF links on landing pages (e.g. Sustainability reports)
    const pdfLinks: string[] = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (href.toLowerCase().includes(".pdf")) {
        try {
          const fullPdfUrl = new URL(href, url).toString();
          if (isPublicUrl(fullPdfUrl) && !pdfLinks.includes(fullPdfUrl)) {
            pdfLinks.push(fullPdfUrl);
          }
        } catch {
          // ignore invalid URLs
        }
      }
    });

    title = $("title").first().text().trim() || "Untitled source";

    // Clean up unnecessary boilerplate before markdown conversion
    $(
      "script, style, noscript, svg, iframe, nav, footer, header, .mw-editsection, .reflist, .navbox, #mw-navigation, #siteSub, #contentSub, .ads, .cookie-banner"
    ).remove();

    const mainHtml = $("main").length ? $("main").html() : $("body").html();

    if (mainHtml) {
      try {
        text = turndownService.turndown(mainHtml).trim();
      } catch {
        text = $("body").text().replace(/\s+/g, " ").trim();
      }
    } else {
      text = $("body").text().replace(/\s+/g, " ").trim();
    }

    // If page links to attached PDFs, parse top PDF text and append
    if (pdfLinks.length > 0) {
      for (const pdfUrl of pdfLinks.slice(0, 2)) {
        try {
          const pdfRes = await fetchBufferWithTimeout(pdfUrl);
          if (pdfRes.status >= 200 && pdfRes.status < 300) {
            const pdfText = await parsePdfBuffer(pdfRes.buffer);
            if (pdfText.length > 100) {
              text += `\n\n### [Attached Report PDF (${pdfUrl})]:\n` + pdfText;
            }
          }
        } catch {
          // ignore PDF fetch failures
        }
      }
    }
  }

  if (text.length > MAX_CHARS_PER_SOURCE) {
    const head = text.slice(0, 12_000);
    const remaining = text.slice(12_000);
    const keywords = [
      "energy", "electricity", "hvac", "chiller", "cooling", "air conditioning",
      "consumption", "kwh", "mwh", "gigajoule", "gj", "scope 1", "scope 2", "scope 3",
      "emissions", "carbon", "diesel", "solar", "fuel", "target", "baseline"
    ];
    const regex = new RegExp(`\\b(${keywords.join("|")})\\b`, "i");
    const paragraphs = remaining.split(/\n\n+/);
    const relevantParagraphs: string[] = [];
    let currentLen = head.length;

    for (const para of paragraphs) {
      if (regex.test(para)) {
        relevantParagraphs.push(para);
        currentLen += para.length + 2;
        if (currentLen >= MAX_CHARS_PER_SOURCE) break;
      }
    }

    text = `${head}\n\n### [... Key Operational Energy & Telemetry Sections ...]\n\n${relevantParagraphs.join("\n\n")}`.slice(
      0,
      MAX_CHARS_PER_SOURCE
    );
  }

  // If text is a bot challenge page or too short (SPA), fall back to Jina Reader
  if (text.length < 100 || isChallengePage(text, title)) {
    const jinaFallback = await fetchViaJinaReader(url);
    if (
      jinaFallback &&
      jinaFallback.text.length >= 100 &&
      !isChallengePage(jinaFallback.text, jinaFallback.title)
    ) {
      return {
        id,
        title: jinaFallback.title || title,
        url,
        text: jinaFallback.text,
      };
    }
    throw new Error("The source did not contain enough readable text.");
  }

  return { id, title, url, text };
}