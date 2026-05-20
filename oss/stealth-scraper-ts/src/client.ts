/**
 * Async client for the Stealth-Scraper REST API.
 *
 * Built on the WHATWG `fetch` global — runs in Node 18+, Bun, Deno, and
 * edge runtimes (Cloudflare Workers, Vercel Edge) without polyfills.
 */

const DEFAULT_BASE_URL = "https://stealthscraper.dev";
const DEFAULT_TIMEOUT_MS = 60_000;
const SDK_VERSION = "0.1.0";

// ── Types ────────────────────────────────────────────────────────────────

export type TemplateFieldKind = "text" | "attr" | "list" | "html";

export interface TemplateField {
  label: string;
  selector?: string;
  xpath?: string;
  kind?: TemplateFieldKind;
  attr?: string;
}

export interface ElementBbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DetectedElement {
  id: number;
  tag: string;
  bbox: ElementBbox;
  xpath: string;
  css: string;
  text: string;
  attrs: Record<string, string>;
}

export interface SnapshotResponse {
  url: string;
  title: string;
  screenshot: string; // base64 PNG
  viewport: { width: number; height: number };
  page: { width: number; height: number };
  elements: DetectedElement[];
  element_count: number;
}

export interface ExtractResponse {
  url: string;
  title?: string;
  fields: Record<string, unknown>;
  errors: Record<string, string>;
}

export interface BatchExtractResponse {
  count: number;
  results: { url: string; data: ExtractResponse }[];
}

export interface SavedTemplate {
  id: number;
  name: string;
  source_url: string;
  fields: TemplateField[];
  created_at: string;
  updated_at: string;
}

export interface ClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

// ── Error ────────────────────────────────────────────────────────────────

export class StealthScraperError extends Error {
  readonly statusCode: number;
  readonly detail: string;
  readonly body: string;

  constructor(statusCode: number, detail: string, body: string) {
    super(`HTTP ${statusCode}: ${detail || body}`);
    this.name = "StealthScraperError";
    this.statusCode = statusCode;
    this.detail = detail;
    this.body = body;
  }
}

// ── Client ───────────────────────────────────────────────────────────────

export class Client {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;

  readonly templates: TemplatesAPI;

  constructor(opts: ClientOptions = {}) {
    const env = (typeof process !== "undefined" ? process.env : {}) as Record<string, string | undefined>;
    this.apiKey = opts.apiKey ?? env.STEALTH_SCRAPER_API_KEY ?? "";
    if (!this.apiKey) {
      throw new Error(
        "apiKey is required — pass `{ apiKey: 'ssk_...' }` or set STEALTH_SCRAPER_API_KEY. " +
          "Get one at https://stealthscraper.dev/settings/api-keys",
      );
    }
    this.baseUrl = (opts.baseUrl ?? env.STEALTH_SCRAPER_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? Number(env.STEALTH_SCRAPER_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    this.templates = new TemplatesAPI(this);
  }

  // ── HTTP plumbing ──────────────────────────────────────────────────────

  /** @internal */
  async _request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/backend${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": `stealth-scraper-ts/${SDK_VERSION}`,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      if (res.status === 204) return undefined as T;
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let detail = "";
        try {
          const j = JSON.parse(text);
          if (j && typeof j === "object" && "detail" in j) {
            detail = String((j as { detail: unknown }).detail);
          }
        } catch {
          // not JSON, ignore
        }
        throw new StealthScraperError(res.status, detail, text.slice(0, 1024));
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Public methods ─────────────────────────────────────────────────────

  /** Load a URL in stealth Chromium → screenshot + element catalog. Counts as 1 scrape. */
  snapshot(
    url: string,
    opts: { viewportWidth?: number; viewportHeight?: number } = {},
  ): Promise<SnapshotResponse> {
    return this._request<SnapshotResponse>("POST", "/snapshot", {
      url,
      viewport_width: opts.viewportWidth ?? 1440,
      viewport_height: opts.viewportHeight ?? 900,
    });
  }

  /** Run a template against a URL → structured fields. Counts as 1 scrape. */
  extract(url: string, template: TemplateField[]): Promise<ExtractResponse> {
    return this._request<ExtractResponse>("POST", "/extract", { url, template });
  }

  /** One template across many URLs (max 100). Counts as N scrapes. */
  batch(urls: string[], template: TemplateField[]): Promise<BatchExtractResponse> {
    return this._request<BatchExtractResponse>("POST", "/extract/batch", { urls, template });
  }
}

// ── Templates sub-API ────────────────────────────────────────────────────

class TemplatesAPI {
  constructor(private readonly c: Client) {}

  list(): Promise<SavedTemplate[]> {
    return this.c._request<SavedTemplate[]>("GET", "/templates");
  }

  get(id: number): Promise<SavedTemplate> {
    return this.c._request<SavedTemplate>("GET", `/templates/${id}`);
  }

  create(body: {
    name: string;
    source_url: string;
    fields: TemplateField[];
  }): Promise<SavedTemplate> {
    return this.c._request<SavedTemplate>("POST", "/templates", body);
  }

  update(
    id: number,
    body: Partial<{ name: string; source_url: string; fields: TemplateField[] }>,
  ): Promise<SavedTemplate> {
    return this.c._request<SavedTemplate>("PUT", `/templates/${id}`, body);
  }

  delete(id: number): Promise<void> {
    return this.c._request<void>("DELETE", `/templates/${id}`);
  }
}
