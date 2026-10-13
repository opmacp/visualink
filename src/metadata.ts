import { requestUrl } from "obsidian";
import { FetchedMeta } from "./types";
import { acceptLanguage, t } from "./i18n";

/** Normaliza lo que el usuario pega: añade https://, quita espacios y parámetros de tracking. */
export function normalizeUrl(input: string): string | null {
  let raw = input.trim();
  if (!raw) return null;
  // Markdown link [title](url)
  const md = raw.match(/\]\((https?:\/\/[^)\s]+)\)/);
  if (md) raw = md[1];
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    if (!/^[\w-]+(\.[\w-]+)+/.test(raw)) return null;
    raw = "https://" + raw;
  }
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const junk = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid", "igshid", "mc_cid", "mc_eid", "si"];
    junk.forEach((k) => u.searchParams.delete(k));
    u.hash = u.hash === "#" ? "" : u.hash;
    return u.toString();
  } catch {
    return null;
  }
}

/** Extrae todas las URLs de un texto (para pegar varias a la vez). */
export function extractUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  const out = new Set<string>();
  for (const f of found) {
    const n = normalizeUrl(f.replace(/[.,;:!?]+$/, ""));
    if (n) out.add(n);
  }
  if (out.size === 0) {
    const single = normalizeUrl(text);
    if (single) out.add(single);
  }
  return [...out];
}

/** Error de red (sin conexión / DNS / timeout), distinto de un HTTP 404. */
export class OfflineError extends Error {}

/** Propone un título legible a partir de la URL, para cuando no hay conexión. */
export function suggestTitle(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    let slug = decodeURIComponent(parts[parts.length - 1] ?? "");
    slug = slug.replace(/\.(html?|php|aspx?)$/i, "").replace(/[-_+]+/g, " ").trim();
    // descarta ids sueltos (números, hashes)
    const looksLikeId = !slug.includes(" ") && (/\d/.test(slug) || slug.length > 24);
    const generic = ["watch", "index", "item", "status", "post", "p", "comments", "article", "view"];
    if (!slug || looksLikeId || generic.includes(slug.toLowerCase())) return domainOf(url);
    return slug.charAt(0).toUpperCase() + slug.slice(1);
  } catch {
    return url;
  }
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function abs(base: string, maybe?: string | null): string | undefined {
  if (!maybe) return undefined;
  try {
    return new URL(maybe.trim(), base).toString();
  } catch {
    return undefined;
  }
}

function clean(s?: string | null): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

type LdNode = Record<string, unknown>;

function isLdNode(v: unknown): v is LdNode {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** First object in a JSON-LD payload: a bare node, an array of nodes or an @graph. */
function firstLdNode(j: unknown): LdNode | null {
  if (Array.isArray(j)) return isLdNode(j[0]) ? j[0] : null;
  if (!isLdNode(j)) return null;
  const graph = j["@graph"];
  if (Array.isArray(graph) && isLdNode(graph[0])) return graph[0];
  return j;
}

/** Result of reading one HTML page. `rich` = the page had Open Graph / Twitter Card data. */
interface ParsedPage {
  meta: FetchedMeta;
  rich: boolean;
  oembed?: string;
}

/** Pure parser (no network), testable on its own. */
export function parseHtml(html: string, url: string): FetchedMeta {
  return parsePage(html, url).meta;
}

function parsePage(html: string, url: string): ParsedPage {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const meta = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const el =
        doc.querySelector(`meta[property="${k}"]`) ??
        doc.querySelector(`meta[name="${k}"]`) ??
        doc.querySelector(`meta[itemprop="${k}"]`);
      const v = el?.getAttribute("content");
      if (v && v.trim()) return v;
    }
    return undefined;
  };

  // JSON-LD as a fallback (news and recipe sites use it a lot)
  let ld: LdNode = {};
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    if (Object.keys(ld).length) return;
    try {
      const node = firstLdNode(JSON.parse(s.textContent ?? "") as unknown);
      if (node) ld = node;
    } catch {
      /* ignore */
    }
  });
  const ldImage = (() => {
    const im = ld["image"];
    if (typeof im === "string") return im;
    if (Array.isArray(im)) return typeof im[0] === "string" ? im[0] : (im[0] as { url?: string })?.url;
    if (im && typeof im === "object") return (im as { url?: string }).url;
    return undefined;
  })();

  const ogTitle = meta("og:title", "twitter:title");
  const ogImage = meta("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src");
  const title = clean(
    ogTitle ?? (ld["headline"] as string) ?? (ld["name"] as string) ?? doc.querySelector("title")?.textContent ?? doc.querySelector("h1")?.textContent,
  );
  const description = clean(meta("og:description", "twitter:description", "description") ?? (ld["description"] as string));
  const siteName = clean(meta("og:site_name", "application-name", "apple-mobile-web-app-title"));

  let image = abs(url, ogImage ?? meta("image") ?? ldImage ?? doc.querySelector('link[rel="image_src"]')?.getAttribute("href"));
  if (!image) {
    const img = doc.querySelector("article img[src], main img[src]");
    image = abs(url, img?.getAttribute("src"));
  }

  const iconEl =
    doc.querySelector('link[rel="apple-touch-icon"]') ??
    doc.querySelector('link[rel="icon"][sizes]') ??
    doc.querySelector('link[rel="icon"]') ??
    doc.querySelector('link[rel="shortcut icon"]');
  const favicon = abs(url, iconEl?.getAttribute("href")) ?? abs(url, "/favicon.ico");
  const oembed = abs(url, doc.querySelector('link[type="application/json+oembed"]')?.getAttribute("href"));

  return { meta: { url, title, description, siteName, image, favicon }, rich: !!(ogTitle || ogImage), oembed };
}

// ---------------------------------------------------------------- network

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
/** Honest link-preview identity: many sites only serve their preview tags to bots. */
const BOT_UA = "Mozilla/5.0 (compatible; VisualinkBot/1.0; +https://github.com/opmacp/visualink)";

interface Page {
  status: number;
  contentType: string;
  html: string;
}

/** Decodes with the page's own charset so accents survive on non UTF-8 sites. */
function decode(buf: ArrayBuffer, contentType: string): string {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (!charset) charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(new TextDecoder("latin1").decode(buf.slice(0, 4096)))?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(buf);
  } catch {
    return new TextDecoder().decode(buf);
  }
}

async function getPage(url: string, ua: string): Promise<Page> {
  let res;
  try {
    res = await requestUrl({
      url,
      headers: { "User-Agent": ua, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8", "Accept-Language": acceptLanguage() },
      throw: false,
    });
  } catch (e) {
    throw new OfflineError(String(e));
  }
  const contentType = (res.headers["content-type"] ?? res.headers["Content-Type"] ?? "").toLowerCase();
  const isText = !contentType || contentType.includes("html") || contentType.includes("xml") || contentType.startsWith("text/");
  return { status: res.status, contentType, html: isText ? decode(res.arrayBuffer, contentType) : "" };
}

/** Titles that belong to a block page or a bare app shell, not to the link. */
const BLOCK_TITLE = /^(just a moment|attention required|access denied|forbidden|robot check|are you a robot|security check|captcha|log ?in|sign ?in|page not found|404|403|error)\b/i;

function isGenericTitle(title: string, url: string, rich: boolean): boolean {
  if (!title || BLOCK_TITLE.test(title)) return true;
  // App shells and bare brand names: "Reddit", "Amazon", "TikTok - Make Your Day"...
  const brand = domainOf(url).split(".").slice(-2)[0].replace(/[^a-z0-9]/g, "");
  const flat = title.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (flat === brand || flat === `${brand}com`) return true;
  return !rich && flat.startsWith(brand) && title.length < 40;
}

function quality(p: ParsedPage | null, url: string): number {
  if (!p) return -1;
  return (isGenericTitle(p.meta.title, url, p.rich) ? 0 : 2) + (p.meta.image ? 2 : 0) + (p.meta.description ? 1 : 0);
}

/** Keeps the better page and fills its gaps from the other one. */
function merge(a: ParsedPage | null, b: ParsedPage | null, url: string): ParsedPage | null {
  if (!a || !b) return a ?? b;
  const [best, other] = quality(b, url) > quality(a, url) ? [b, a] : [a, b];
  const m = { ...best.meta };
  if (isGenericTitle(m.title, url, best.rich) && !isGenericTitle(other.meta.title, url, other.rich)) m.title = other.meta.title;
  m.image ??= other.meta.image;
  m.description ||= other.meta.description;
  m.siteName ||= other.meta.siteName;
  return { meta: m, rich: best.rich || other.rich, oembed: best.oembed ?? other.oembed };
}

/** oEmbed endpoints for sites that don't advertise one in their HTML. */
const OEMBED: [RegExp, string][] = [
  [/(^|\.)reddit\.com$/, "https://www.reddit.com/oembed?url="],
  [/(^|\.)(x|twitter)\.com$/, "https://publish.twitter.com/oembed?omit_script=1&url="],
  [/(^|\.)tiktok\.com$/, "https://www.tiktok.com/oembed?url="],
  [/(^|\.)bsky\.app$/, "https://embed.bsky.app/oembed?url="],
  [/(^|\.)vimeo\.com$/, "https://vimeo.com/api/oembed.json?url="],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "https://www.youtube.com/oembed?format=json&url="],
];

function knownOEmbed(url: string): string | undefined {
  const host = new URL(url).hostname;
  const hit = OEMBED.find(([re]) => re.test(host));
  return hit ? hit[1] + encodeURIComponent(url) : undefined;
}

function textOf(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return clean((doc.querySelector("p") ?? doc.querySelector("a") ?? doc.body)?.textContent);
}

async function fetchOEmbed(endpoint: string, url: string): Promise<ParsedPage | null> {
  try {
    const r = await requestUrl({ url: endpoint, headers: { "User-Agent": BOT_UA, Accept: "application/json" }, throw: false });
    if (r.status >= 400) return null;
    const j = JSON.parse(r.text) as unknown;
    if (!isLdNode(j)) return null;
    const str = (k: string) => (typeof j[k] === "string" ? j[k] : "");
    const title = clean(str("title")) || (str("html") ? textOf(str("html")) : "");
    const author = clean(str("author_name"));
    return {
      meta: {
        url,
        title: title.length > 160 ? `${title.slice(0, 157)}…` : title,
        description: author ? t("meta.byAuthor", { author }) : "",
        siteName: clean(str("provider_name")),
        image: abs(url, str("thumbnail_url")),
      },
      rich: !!title,
    };
  } catch {
    return null;
  }
}

/** YouTube: a high quality thumbnail without depending on the HTML. */
function youtubeThumb(url: string): string | undefined {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.slice(1);
  if (host.endsWith("youtube.com")) id = u.searchParams.get("v") ?? (u.pathname.startsWith("/shorts/") ? u.pathname.split("/")[2] : null);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : undefined;
}

function fileTitle(url: string): string {
  return decodeURIComponent(new URL(url).pathname.split("/").pop() || url);
}

/**
 * Builds a card from a link. Tries, in order, until the result looks good:
 * the page as a browser → the page as an honest bot → the site's oEmbed.
 * requestUrl avoids the browser's CORS limits.
 */
export async function fetchMetadata(url: string): Promise<FetchedMeta> {
  const first = await getPage(url, BROWSER_UA);
  if (first.contentType.startsWith("image/")) return { url, title: fileTitle(url), description: "", siteName: "", image: url };
  if (first.contentType.includes("pdf")) return { url, title: fileTitle(url), description: t("meta.pdf"), siteName: "" };

  const good = (p: ParsedPage | null) => quality(p, url) >= 4;
  let page = first.status < 400 && first.html ? parsePage(first.html, url) : null;
  if (!good(page)) {
    const second = await getPage(url, BOT_UA).catch(() => null);
    if (second && second.status < 400 && second.html) page = merge(page, parsePage(second.html, url), url);
  }
  const endpoint = page?.oembed ?? knownOEmbed(url);
  if (!good(page) && endpoint) page = merge(page, await fetchOEmbed(endpoint, url), url);
  if (!page) {
    // A missing page is an error; a site that only blocks bots still gets a readable card.
    if (first.status === 404 || first.status === 410) throw new Error(`HTTP ${first.status}`);
    page = { meta: { url, title: suggestTitle(url), description: "", siteName: "" }, rich: false };
  }

  const meta = page.meta;
  const yt = youtubeThumb(url);
  if (yt) {
    meta.image = yt;
    meta.siteName = "YouTube";
  }
  if (isGenericTitle(meta.title, url, page.rich)) meta.title = suggestTitle(url);
  if (BLOCK_TITLE.test(meta.description)) meta.description = "";
  return meta;
}

/** Descarga una imagen y devuelve bytes + extensión. */
export async function downloadImage(url: string): Promise<{ data: ArrayBuffer; ext: string } | null> {
  try {
    const r = await requestUrl({ url, headers: { "User-Agent": BROWSER_UA }, throw: false });
    if (r.status >= 400) return null;
    const ct = (r.headers["content-type"] ?? r.headers["Content-Type"] ?? "").toLowerCase();
    if (ct && !ct.startsWith("image/")) return null;
    const map: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/svg+xml": "svg",
      "image/x-icon": "ico",
      "image/vnd.microsoft.icon": "ico",
      "image/avif": "avif",
    };
    let ext = map[ct.split(";")[0].trim()];
    if (!ext) {
      const m = new URL(url).pathname.match(/\.(jpe?g|png|webp|gif|svg|ico|avif)$/i);
      ext = m ? m[1].toLowerCase().replace("jpeg", "jpg") : "img";
    }
    if (r.arrayBuffer.byteLength < 64) return null;
    return { data: r.arrayBuffer, ext };
  } catch {
    return null;
  }
}
