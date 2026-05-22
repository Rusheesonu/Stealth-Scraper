/**
 * Public types for the Stealth Scraper TypeScript SDK.
 *
 * The shapes here mirror the Python SDK 1:1 so multi-language users get a
 * consistent mental model. Result objects carry a `raw` field with the
 * full backend payload, so forward-compat fields are reachable without
 * waiting on an SDK release.
 */

export interface StealthClientOptions {
  /** API key, e.g. `ssk_xxx`. Falls back to env `STEALTH_SCRAPER_API_KEY`. */
  apiKey?: string;
  /** Base URL of the API. Defaults to `https://api.stealthscraper.dev`. */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 120000. */
  timeoutMs?: number;
  /** Override fetch implementation (e.g. for tests). Defaults to global `fetch`. */
  fetch?: typeof fetch;
}

export interface RequestOptions {
  /**
   * Optional idempotency key. Auto-generated (UUID4) if omitted. Sent as
   * `Idempotency-Key`. Same key replayed within the server-side dedupe
   * window returns the original response.
   */
  idempotencyKey?: string;
  /** Optional AbortSignal to cancel the request. */
  signal?: AbortSignal;
}

export interface BrowserAction {
  type: string;
  [key: string]: unknown;
}

export interface SnapshotRequest extends RequestOptions {
  url: string;
  viewportWidth?: number;
  viewportHeight?: number;
  actions?: BrowserAction[];
}

export interface SnapshotResult {
  url: string;
  title: string;
  /** Base64-encoded PNG of the rendered page. */
  screenshot: string;
  viewport: { width: number; height: number };
  page: Record<string, unknown>;
  elements: Array<Record<string, unknown>>;
  elementCount: number;
  /** Full raw response from the backend (for forward-compat fields). */
  raw: Record<string, unknown>;
}

export interface TemplateField {
  name: string;
  selector?: string;
  attribute?: string;
  [key: string]: unknown;
}

export interface ExtractRequest extends RequestOptions {
  url: string;
  /** Inline template. Mutually exclusive with `templateId`. */
  template?: TemplateField[];
  /** ID of a saved template. Mutually exclusive with `template`. */
  templateId?: string;
  outputFormat?: "json" | "csv";
  paginationSelector?: string;
  maxPages?: number;
  actions?: BrowserAction[];
}

export interface ExtractResult {
  url: string;
  title: string;
  fields: Record<string, unknown>;
  errors: Record<string, string>;
  raw: Record<string, unknown>;
}

export interface AssistExtractRequest extends RequestOptions {
  url: string;
  description: string;
  viewportWidth?: number;
  viewportHeight?: number;
}

export interface AssistExtractResult {
  url: string;
  title: string;
  description: string;
  template: TemplateField[];
  fields: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface EstimateRequest extends RequestOptions {
  url: string;
  template?: TemplateField[];
  schema?: TemplateField[];
}

export interface EstimateResult {
  estimatedCredits: number;
  estimatedUsd: number;
  planCreditsRemaining?: number;
  breakdown: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface Template {
  id: string;
  name: string;
  sourceUrl: string;
  fields: TemplateField[];
  raw: Record<string, unknown>;
}

export type SnapshotProgressEvent =
  | "queued"
  | "navigating"
  | "rendering"
  | "extracting"
  | "done"
  | "error"
  | "message";

export interface SnapshotProgress {
  event: SnapshotProgressEvent;
  message: string;
  /** 0.0–1.0. */
  progress: number;
  /** Populated when `event === "done"`. */
  result?: SnapshotResult;
  raw: Record<string, unknown>;
}

/** Shape of typed error envelopes returned by the API. */
export interface ApiErrorDetail {
  kind?: string;
  message?: string;
  vendor?: string;
  suggestion?: string;
  used?: number;
  limit?: number;
  upgrade_url?: string;
  retry_after_s?: number;
  [key: string]: unknown;
}
