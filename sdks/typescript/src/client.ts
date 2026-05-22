/**
 * StealthClient — TypeScript SDK for the Stealth Scraper API.
 *
 * Design notes:
 *   * Uses the global `fetch` (Node 18+ ships it). Pass a custom impl via
 *     `options.fetch` for testing or to route through an HTTP/2-aware
 *     transport on older runtimes.
 *   * Mutating calls auto-generate an `Idempotency-Key` header (UUID4) when
 *     the caller doesn't provide one. Cheap insurance against duplicate
 *     spend on retried requests.
 *   * Error envelopes are translated to typed subclasses (`AntiBotBlockError`
 *     etc.) so callers can `catch (e)` and `instanceof` for the specific
 *     failure mode they care about.
 */

import {
  AntiBotBlockError,
  ApiError,
  AuthError,
  KIND_TO_ERROR,
  OverloadedError,
  PlanLimitError,
  RateLimitError,
  StealthScraperError,
} from "./errors.js";
import type {
  ApiErrorDetail,
  AssistExtractRequest,
  AssistExtractResult,
  EstimateRequest,
  EstimateResult,
  ExtractRequest,
  ExtractResult,
  RequestOptions,
  SnapshotProgress,
  SnapshotRequest,
  SnapshotResult,
  StealthClientOptions,
  Template,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.stealthscraper.dev";
const DEFAULT_TIMEOUT_MS = 120_000;
const SDK_VERSION = "0.1.0";
const USER_AGENT = `stealth-scraper-js/${SDK_VERSION}`;

function genIdempotencyKey(): string {
  // crypto.randomUUID is in Node 18.17+ and all modern browsers. Fall back
  // to a Math.random hex string if somehow unavailable — collision risk is
  // trivial for an idempotency key that's only valid in a small server-side
  // dedupe window.
  const g: { crypto?: { randomUUID?: () => string } } = globalThis as never;
  if (g.crypto && typeof g.crypto.randomUUID === "function") {
    return `sdk-${g.crypto.randomUUID().replace(/-/g, "")}`;
  }
  const hex = (n: number) =>
    Math.floor(Math.random() * 16 ** n)
      .toString(16)
      .padStart(n, "0");
  return `sdk-${hex(8)}${hex(8)}${hex(8)}${hex(8)}`;
}

function parseDetail(payload: unknown): {
  kind?: string;
  message: string;
  detail: ApiErrorDetail | string | null;
} {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (detail && typeof detail === "object") {
      const d = detail as ApiErrorDetail;
      return {
        kind: d.kind,
        message: d.message ?? JSON.stringify(d),
        detail: d,
      };
    }
    return { message: String(detail ?? ""), detail: String(detail ?? "") };
  }
  return { message: String(payload ?? ""), detail: null };
}

function buildHeaders(
  apiKey: string,
  idempotencyKey: string | undefined,
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "User-Agent": USER_AGENT,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  if (extra) Object.assign(headers, extra);
  return headers;
}

async function raiseForStatus(response: Response): Promise<void> {
  if (response.ok) return;

  const requestId = response.headers.get("x-request-id") ?? undefined;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = { detail: (await response.text().catch(() => "")) || response.statusText };
  }

  const { kind, message, detail } = parseDetail(payload);
  const status = response.status;

  // Status-code shortcuts for cases the backend doesn't always tag.
  if ((status === 401 || status === 403) && !kind) {
    throw new AuthError(message || "authentication failed", {
      statusCode: status,
      kind,
      detail,
      requestId,
    });
  }

  // Resolve the constructor: kind-based first, then status-code fallback.
  let Ctor = (kind ? KIND_TO_ERROR[kind] : undefined) ?? ApiError;
  if (Ctor === ApiError && status === 429) Ctor = RateLimitError;
  if (Ctor === ApiError && status === 503) Ctor = OverloadedError;

  // Common opts every subclass accepts.
  const baseOpts = { statusCode: status, kind, detail, requestId };

  // Detail extras the typed subclasses care about.
  const detailObj: ApiErrorDetail | null =
    detail && typeof detail === "object" ? (detail as ApiErrorDetail) : null;
  const retryAfterHeader = response.headers.get("retry-after");
  const retryFromHeader = retryAfterHeader != null && !Number.isNaN(Number(retryAfterHeader))
    ? Number(retryAfterHeader)
    : undefined;

  if (Ctor === AntiBotBlockError) {
    throw new AntiBotBlockError(message, {
      ...baseOpts,
      vendor: detailObj?.vendor,
      suggestion: detailObj?.suggestion,
    });
  }
  if (Ctor === PlanLimitError) {
    throw new PlanLimitError(message, {
      ...baseOpts,
      used: detailObj?.used,
      limit: detailObj?.limit,
      upgradeUrl: detailObj?.upgrade_url,
    });
  }
  if (Ctor === OverloadedError) {
    throw new OverloadedError(message, {
      ...baseOpts,
      retryAfterS: detailObj?.retry_after_s ?? retryFromHeader,
    });
  }
  if (Ctor === RateLimitError) {
    throw new RateLimitError(message, {
      ...baseOpts,
      retryAfterS: detailObj?.retry_after_s ?? retryFromHeader,
    });
  }
  if (Ctor === AuthError) {
    throw new AuthError(message, baseOpts);
  }
  throw new Ctor(message, baseOpts);
}

function ensureApiKey(opts: StealthClientOptions): string {
  const fromEnv =
    typeof process !== "undefined" && process.env
      ? process.env.STEALTH_SCRAPER_API_KEY
      : undefined;
  const key = opts.apiKey ?? fromEnv;
  if (!key) {
    throw new StealthScraperError(
      "apiKey is required. Pass it explicitly or set STEALTH_SCRAPER_API_KEY in the environment.",
    );
  }
  return key;
}

/**
 * StealthClient — main entry point.
 *
 * @example
 * ```ts
 * import { StealthClient } from 'stealth-scraper';
 * const client = new StealthClient({ apiKey: 'ssk_...' });
 * const snap = await client.snapshot('https://news.ycombinator.com/');
 * ```
 */
export class StealthClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: StealthClientOptions = {}) {
    this.apiKey = ensureApiKey(options);
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? fetch;
  }

  // ---- low-level transport ------------------------------------------------

  private url(path: string): string {
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  private async request<T>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      idempotencyKey?: string;
      signal?: AbortSignal;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const isMutation = method !== "GET" && method !== "HEAD";
    const idem = options.idempotencyKey ?? (isMutation ? genIdempotencyKey() : undefined);
    const headers = buildHeaders(this.apiKey, idem, options.headers);

    // Compose a timeout-aware signal. If caller passed one, honour it too.
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), this.timeoutMs);
    if (options.signal) {
      if (options.signal.aborted) ctrl.abort();
      options.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
    }

    try {
      const resp = await this.fetchImpl(this.url(path), {
        method,
        headers,
        body: options.body == null ? undefined : JSON.stringify(options.body),
        signal: ctrl.signal,
      });
      await raiseForStatus(resp);
      if (resp.status === 204) return {} as T;
      const text = await resp.text();
      if (!text) return {} as T;
      return JSON.parse(text) as T;
    } catch (err) {
      if (err instanceof ApiError || err instanceof StealthScraperError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new ApiError(`request aborted (timeout ${this.timeoutMs}ms or caller signal)`, {
          statusCode: 0,
        });
      }
      throw new ApiError(`network error: ${(err as Error).message ?? err}`, { statusCode: 0 });
    } finally {
      clearTimeout(timeout);
    }
  }

  // ---- public API ---------------------------------------------------------

  /** Take a stealth snapshot — screenshot + structured element catalog. */
  async snapshot(urlOrReq: string | SnapshotRequest, options?: RequestOptions): Promise<SnapshotResult> {
    const req: SnapshotRequest =
      typeof urlOrReq === "string" ? { url: urlOrReq, ...(options ?? {}) } : urlOrReq;
    const body: Record<string, unknown> = { url: req.url };
    if (req.viewportWidth != null) body.viewport_width = req.viewportWidth;
    if (req.viewportHeight != null) body.viewport_height = req.viewportHeight;
    if (req.actions) body.actions = req.actions;

    const data = await this.request<Record<string, unknown>>("POST", "/snapshot", {
      body,
      idempotencyKey: req.idempotencyKey,
      signal: req.signal,
    });
    return toSnapshotResult(data);
  }

  /** Extract structured data using either an inline `template` or a saved `templateId`. */
  async extract(req: ExtractRequest): Promise<ExtractResult> {
    if (!req.template && !req.templateId) {
      throw new StealthScraperError("extract() requires either `template` or `templateId`.");
    }
    let template = req.template;
    if (!template && req.templateId) {
      const t = await this.getTemplate(req.templateId);
      template = t.fields;
    }
    const body: Record<string, unknown> = {
      url: req.url,
      template,
      output_format: req.outputFormat ?? "json",
      max_pages: req.maxPages ?? 1,
    };
    if (req.paginationSelector) body.pagination_selector = req.paginationSelector;
    if (req.actions) body.actions = req.actions;

    const data = await this.request<Record<string, unknown>>("POST", "/extract", {
      body,
      idempotencyKey: req.idempotencyKey,
      signal: req.signal,
    });
    return toExtractResult(data);
  }

  /** AI-assisted: describe what you want in English, get a template + values. */
  async assistExtract(req: AssistExtractRequest): Promise<AssistExtractResult> {
    const body: Record<string, unknown> = { url: req.url, description: req.description };
    if (req.viewportWidth != null) body.viewport_width = req.viewportWidth;
    if (req.viewportHeight != null) body.viewport_height = req.viewportHeight;

    const data = await this.request<Record<string, unknown>>("POST", "/assist/schema", {
      body,
      idempotencyKey: req.idempotencyKey,
      signal: req.signal,
    });
    return toAssistExtractResult(data);
  }

  /** Preview credit cost before running a scrape. */
  async estimate(req: EstimateRequest): Promise<EstimateResult> {
    const body: Record<string, unknown> = { url: req.url };
    if (req.template) body.template = req.template;
    if (req.schema) body.schema = req.schema;
    const data = await this.request<Record<string, unknown>>("POST", "/estimate", {
      body,
      idempotencyKey: req.idempotencyKey,
      signal: req.signal,
    });
    return toEstimateResult(data);
  }

  /** List the authenticated user's saved templates. */
  async listTemplates(): Promise<Template[]> {
    const data = await this.request<unknown>("GET", "/templates");
    const items = Array.isArray(data)
      ? data
      : ((data as { items?: unknown[] }).items ?? []);
    return items.map((it) => toTemplate(it as Record<string, unknown>));
  }

  async getTemplate(templateId: string): Promise<Template> {
    const data = await this.request<Record<string, unknown>>("GET", `/templates/${templateId}`);
    return toTemplate(data);
  }

  /** Convenience: run a saved template against `url`. */
  async runTemplate(templateId: string, url: string, options?: RequestOptions): Promise<ExtractResult> {
    return this.extract({ url, templateId, ...(options ?? {}) });
  }

  /**
   * Stream snapshot progress events.
   *
   * NOTE: requires the backend to expose `/snapshot/stream` returning
   * `text/event-stream`. If the endpoint 404s, falls back to a synthetic
   * "queued → done" event pair wrapping a normal {@link snapshot} call so
   * callers can adopt the API today.
   */
  async *snapshotStream(req: SnapshotRequest): AsyncGenerator<SnapshotProgress, void, void> {
    const body: Record<string, unknown> = { url: req.url };
    if (req.viewportWidth != null) body.viewport_width = req.viewportWidth;
    if (req.viewportHeight != null) body.viewport_height = req.viewportHeight;
    if (req.actions) body.actions = req.actions;

    const idem = req.idempotencyKey ?? genIdempotencyKey();
    const headers = buildHeaders(this.apiKey, idem, { Accept: "text/event-stream" });

    let resp: Response;
    try {
      resp = await this.fetchImpl(this.url("/snapshot/stream"), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (err) {
      throw new ApiError(`streaming snapshot failed: ${(err as Error).message ?? err}`);
    }

    if (resp.status === 404) {
      // Streaming endpoint not deployed — synthesize a 2-event stream so
      // callers don't have to special-case.
      yield {
        event: "queued",
        message: "streaming endpoint unavailable; falling back to /snapshot",
        progress: 0,
        raw: {},
      };
      const snap = await this.snapshot({ ...req, idempotencyKey: idem });
      yield { event: "done", message: "done", progress: 1, result: snap, raw: {} };
      return;
    }

    if (!resp.ok) {
      await raiseForStatus(resp);
    }

    if (!resp.body) {
      throw new ApiError("streaming response had no body");
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by blank lines.
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            const ev = JSON.parse(payload) as Record<string, unknown>;
            const out: SnapshotProgress = {
              event: ((ev.event as string) ?? "message") as SnapshotProgress["event"],
              message: (ev.message as string) ?? "",
              progress: Number(ev.progress ?? 0),
              raw: ev,
            };
            if (out.event === "done" && ev.result && typeof ev.result === "object") {
              out.result = toSnapshotResult(ev.result as Record<string, unknown>);
            }
            yield out;
          } catch {
            // Skip malformed lines — SSE is intentionally tolerant.
          }
        }
      }
    }
  }
}

// ---- response → typed-object mappers ---------------------------------------

function toSnapshotResult(d: Record<string, unknown>): SnapshotResult {
  return {
    url: (d.url as string) ?? "",
    title: (d.title as string) ?? "",
    screenshot: (d.screenshot as string) ?? "",
    viewport: (d.viewport as { width: number; height: number }) ?? { width: 0, height: 0 },
    page: (d.page as Record<string, unknown>) ?? {},
    elements: (d.elements as Array<Record<string, unknown>>) ?? [],
    elementCount:
      typeof d.element_count === "number"
        ? (d.element_count as number)
        : Array.isArray(d.elements)
          ? (d.elements as unknown[]).length
          : 0,
    raw: d,
  };
}

function toExtractResult(d: Record<string, unknown>): ExtractResult {
  return {
    url: (d.url as string) ?? "",
    title: (d.title as string) ?? "",
    fields: (d.fields as Record<string, unknown>) ?? {},
    errors: (d.errors as Record<string, string>) ?? {},
    raw: d,
  };
}

function toAssistExtractResult(d: Record<string, unknown>): AssistExtractResult {
  return {
    url: (d.url as string) ?? "",
    title: (d.title as string) ?? "",
    description: (d.description as string) ?? "",
    template: (d.template as AssistExtractResult["template"]) ?? [],
    fields: (d.fields as Record<string, unknown>) ?? {},
    raw: d,
  };
}

function toEstimateResult(d: Record<string, unknown>): EstimateResult {
  return {
    estimatedCredits: Number(d.estimated_credits ?? 0),
    estimatedUsd: Number(d.estimated_usd ?? 0),
    planCreditsRemaining:
      d.plan_credits_remaining == null ? undefined : Number(d.plan_credits_remaining),
    breakdown: (d.breakdown as Record<string, unknown>) ?? {},
    raw: d,
  };
}

function toTemplate(d: Record<string, unknown>): Template {
  return {
    id: String(d.id ?? ""),
    name: (d.name as string) ?? "",
    sourceUrl: (d.source_url as string) ?? "",
    fields: (d.fields as Template["fields"]) ?? [],
    raw: d,
  };
}
