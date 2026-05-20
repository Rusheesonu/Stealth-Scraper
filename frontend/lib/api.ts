/**
 * Backend API client. All calls route through Next.js rewrites
 * (`/api/backend/*` → `FASTAPI_URL/*`) so there's no CORS in the browser.
 *
 * Auth: the current Supabase session's access_token is attached as a
 * Bearer header on every request. Backend verifies the JWT via Supabase's
 * JWKS endpoint and 401s if it's missing/expired/invalid.
 */

import { createClient } from "@/lib/supabase/client";

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

export type TemplateField = {
  label: string;
  selector: string;
  xpath?: string;
  kind: "text" | "attr" | "list" | "html";
  attr?: string;
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
    let detail = body;
    try {
      const parsed = JSON.parse(body);
      if (parsed?.detail) detail = parsed.detail;
    } catch {
      // body wasn't JSON — leave as-is
    }
    if (res.status === 401) {
      // Token missing/expired — bounce to login, preserve next.
      if (typeof window !== "undefined") {
        const next = encodeURIComponent(window.location.pathname);
        window.location.href = `/login?next=${next}`;
      }
      throw new Error("Not signed in. Redirecting…");
    }
    if (res.status === 403) {
      throw new Error(`Plan limit: ${detail}`);
    }
    throw new Error(`${res.status}: ${detail || path}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
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
