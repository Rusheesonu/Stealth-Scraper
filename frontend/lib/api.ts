/**
 * Backend API client. All calls route through Next.js rewrites
 * (`/api/backend/*` → `FASTAPI_URL/*`) so there's no CORS in the browser.
 *
 * Auth: the current Supabase session's access_token is attached as a
 * Bearer header on every request. Backend verifies the JWT via Supabase's
 * JWKS endpoint and 401s if it's missing/expired/invalid.
 */

import { createClient } from "@/lib/supabase/client";

/**
 * Structured anti-bot block detail. Sent by /public/snapshot-and-suggest
 * (status 422) when the page is a Cloudflare/PerimeterX/etc. challenge
 * instead of real content. We surface this in the UI so visitors see
 * "Cloudflare blocked this — try residential proxies" instead of a
 * generic failure.
 */
export type AntiBotBlockDetail = {
  kind: "anti_bot_block";
  vendor: string;
  title: string;
  message: string;
  suggestion: string;
  is_behavioral: boolean;
};

/**
 * Error thrown by the API client. Preserves the HTTP status + the
 * parsed `detail` field from the backend response (which may be an
 * object — e.g. anti_bot_block — not just a string). Lets call sites
 * branch on shape without re-parsing message text.
 */
export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export type ElementBbox = { x: number; y: number; w: number; h: number };

export type DetectedElement = {
  id: number;
  tag: string;
  bbox: ElementBbox;
  xpath: string;
  css: string;
  text: string;
  attrs: Record<string, string>;
};

export type SnapshotResponse = {
  url: string;
  title: string;
  screenshot: string; // base64 PNG
  viewport: { width: number; height: number };
  page: { width: number; height: number };
  elements: DetectedElement[];
  element_count: number;
};

/**
 * A post-extraction cleanup step. Safe ops only — no eval, no code exec.
 * Server-side dispatch via TRANSFORM_OPS in backend/app/extract.py.
 * Unknown ops are no-ops so removing an op never breaks saved templates.
 */
export type TransformOp =
  | "strip"
  | "lower"
  | "upper"
  | "strip_prefix"
  | "strip_suffix"
  | "regex_replace"
  | "regex_extract"
  | "split"
  | "slice"
  | "to_int"
  | "to_float"
  | "collapse_whitespace";

export type Transform = {
  op: TransformOp;
  value?: string;     // strip_prefix / strip_suffix
  pattern?: string;   // regex_replace / regex_extract
  repl?: string;      // regex_replace
  sep?: string;       // split
  start?: number;     // slice
  end?: number;       // slice
};

export type TemplateField = {
  label: string;
  selector: string;
  xpath?: string;
  kind: "text" | "attr" | "list" | "html" | "markdown";
  attr?: string;
  transforms?: Transform[];
};

export type SavedTemplate = {
  id: number;
  name: string;
  source_url: string;
  fields: TemplateField[];
  created_at: string;
  updated_at: string;
};

export type ExtractResponse = {
  url: string;
  title?: string;
  fields: Record<string, unknown>;
  errors: Record<string, string>;
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const authHeader: Record<string, string> = session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : {};

  const res = await fetch(`/api/backend${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeader,
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let detail: unknown = body;
    try {
      const parsed = JSON.parse(body);
      if (parsed && "detail" in parsed) detail = parsed.detail;
    } catch {
      // body wasn't JSON — leave as-is
    }
    if (res.status === 401) {
      // Token missing/expired — bounce to login, preserve next.
      if (typeof window !== "undefined") {
        const next = encodeURIComponent(window.location.pathname);
        window.location.href = `/login?next=${next}`;
      }
      throw new ApiError(401, detail, "Not signed in. Redirecting…");
    }
    // Build a readable fallback `message`. If detail is an object we use
    // its `.message` (anti-bot shape) or stringify it; if it's a string,
    // use it directly. This keeps `.message` useful for legacy string-
    // based heuristics while `.detail` carries the structured payload.
    const detailStr =
      typeof detail === "string"
        ? detail
        : detail && typeof detail === "object" && "message" in detail
          ? String((detail as { message?: unknown }).message ?? "")
          : JSON.stringify(detail);
    if (res.status === 403) {
      throw new ApiError(403, detail, `Plan limit: ${detailStr}`);
    }
    throw new ApiError(res.status, detail, `${res.status}: ${detailStr || path}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/**
 * Response shape from /public/snapshot-and-suggest — the landing-page
 * magic preview. No auth required; rate-limited per IP server-side.
 */
export type PublicSnapshotResponse = {
  url: string;
  title: string;
  screenshot: string;                                  // base64 PNG
  page_type: "ecommerce_product" | "ecommerce_listing" | "article" | "social_feed" | "generic";
  template: TemplateField[];                            // up to 5 auto-suggested fields
  sample_values: Record<string, unknown>;               // live extracted values
  element_count: number;
  rate_limit: {
    limit: number;
    used: number;
    remaining: number;
    reset_seconds: number;
  };
};

export const api = {
  /**
   * Public no-signup landing preview. Returns a screenshot + 3-5
   * auto-discovered fields with their live extracted values. Rate-limited
   * per IP (default 3/hr). Soft-fails when the LLM is misconfigured —
   * the visitor still gets the screenshot.
   */
  publicSnapshotAndSuggest: (url: string) =>
    call<PublicSnapshotResponse>("/public/snapshot-and-suggest", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),

  snapshot: (url: string, viewport?: { width: number; height: number }) =>
    call<SnapshotResponse>("/snapshot", {
      method: "POST",
      body: JSON.stringify({
        url,
        viewport_width: viewport?.width ?? 1440,
        viewport_height: viewport?.height ?? 900,
      }),
    }),

  extract: (url: string, template: TemplateField[]) =>
    call<ExtractResponse>("/extract", {
      method: "POST",
      body: JSON.stringify({ url, template }),
    }),

  extractBatch: (urls: string[], template: TemplateField[]) =>
    call<{ count: number; results: { url: string; data: ExtractResponse }[] }>(
      "/extract/batch",
      {
        method: "POST",
        body: JSON.stringify({ urls, template }),
      }
    ),

  listTemplates: () => call<SavedTemplate[]>("/templates"),

  getTemplate: (id: number) => call<SavedTemplate>(`/templates/${id}`),

  createTemplate: (body: { name: string; source_url: string; fields: TemplateField[] }) =>
    call<SavedTemplate>("/templates", { method: "POST", body: JSON.stringify(body) }),

  updateTemplate: (id: number, body: Partial<{ name: string; source_url: string; fields: TemplateField[] }>) =>
    call<SavedTemplate>(`/templates/${id}`, { method: "PUT", body: JSON.stringify(body) }),

  deleteTemplate: (id: number) =>
    call<void>(`/templates/${id}`, { method: "DELETE" }),

  createCheckout: (plan: "hobby" | "pro" | "business") =>
    call<{ checkout_url: string }>(
      `/billing/checkout?plan=${encodeURIComponent(plan)}`,
      { method: "POST" },
    ),

  apiKeys: {
    list: () => call<ApiKey[]>("/api-keys"),
    create: (name: string) =>
      call<ApiKey & { key: string }>("/api-keys", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    revoke: (id: number) =>
      call<void>(`/api-keys/${id}`, { method: "DELETE" }),
  },

  usage: () => call<UsageStatus>("/usage"),

  status: () => call<StatusResponse>("/status"),

  assistSchema: (params: {
    url: string;
    description: string;
    viewport_width?: number;
    viewport_height?: number;
  }) =>
    call<{
      url: string;
      title: string;
      description: string;
      template: TemplateField[];
      element_count: number;
    }>("/assist/schema", { method: "POST", body: JSON.stringify(params) }),

  // Marketplace -----------------------------------------------------------
  marketplace: {
    list: () => call<PublicTemplate[]>("/marketplace"),
    publish: (templateId: number, isPublic: boolean, description: string) =>
      call<SavedTemplate>(`/templates/${templateId}/publish`, {
        method: "PUT",
        body: JSON.stringify({ is_public: isPublic, description }),
      }),
    fork: (templateId: number) =>
      call<SavedTemplate>(`/templates/${templateId}/fork`, { method: "POST" }),
  },

  // Scheduled scrapes -----------------------------------------------------
  schedules: {
    list: () => call<ScheduledJob[]>("/schedules"),
    create: (body: {
      template_id: number;
      name: string;
      target_url: string;
      schedule_cron: string;
      webhook_url?: string;
    }) =>
      call<ScheduledJob>("/schedules", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    toggle: (id: number, enabled: boolean) =>
      call<{ id: number; enabled: boolean }>(
        `/schedules/${id}/toggle?enabled=${enabled}`,
        { method: "PUT" },
      ),
    delete: (id: number) =>
      call<void>(`/schedules/${id}`, { method: "DELETE" }),
  },
};

export type PublicTemplate = SavedTemplate & {
  is_public: boolean;
  fork_count: number;
  description: string;
};

export type ScheduledJob = {
  id: number;
  user_id: string;
  template_id: number;
  name: string;
  target_url: string;
  schedule_cron: string;
  webhook_url: string;
  last_run_at: string | null;
  last_status: string | null;
  next_run_at: string | null;
  enabled: number;          // SQLite 0/1
  created_at: string;
  updated_at: string;
};

export type UsageStatus = {
  plan: string;
  year_month: string;
  used: number;
  limit: number;
  remaining: number;
  percent: number;
};

export type StatusResponse = {
  service: string;
  version: string;
  status: string;
  scrape_engine: { running: boolean; proxy_region: string | null };
  components: { name: string; status: string }[];
};

export type ApiKey = {
  id: number;
  name: string;
  prefix: string;             // e.g. "ssk_abc12345"
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};
