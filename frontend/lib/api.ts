/**
 * Backend API client. All calls route through Next.js rewrites
 * (`/api/backend/*` → `FASTAPI_URL/*`) so there's no CORS in the browser.
 */

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
  const res = await fetch(`/api/backend${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body || path}`);
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
};
