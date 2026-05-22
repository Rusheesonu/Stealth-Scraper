/**
 * Tool implementations for the Stealth Scraper MCP server.
 *
 * Each tool wraps a method on `StealthClient` and returns a MCP-compliant
 * `{ content: [{ type: 'text', text: ... }] }` envelope. Errors from the
 * SDK are caught at the dispatcher boundary and surfaced as MCP `isError`
 * responses so the calling agent sees a clear failure mode instead of a
 * raw stack trace.
 *
 * The schemas below are plain JSON Schema (the format the MCP SDK expects
 * for `inputSchema`). We keep them minimal — the SDK enforces the rest.
 */

import { StealthClient, type TemplateField } from "stealth-scraper";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "scrape_url",
    description:
      "Stealth-scrape a URL with optional natural-language field hints. Uses Stealth Scraper's anti-bot-resistant browser pool. Returns extracted structured data plus the page title.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to scrape (https://...)" },
        fields: {
          type: "string",
          description:
            "Optional natural-language description of what to extract, e.g. 'top 20 story titles, scores, and links'. If omitted, returns the raw page element catalog.",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "extract_structured",
    description:
      "Run a one-shot structured extraction against a URL using an inline schema (list of fields with CSS selectors).",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        schema: {
          type: "array",
          description:
            "Array of field objects, e.g. [{ name: 'title', selector: 'h1' }, { name: 'price', selector: '.price', attribute: 'data-price' }]",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              selector: { type: "string" },
              attribute: { type: "string" },
            },
            required: ["name"],
          },
        },
      },
      required: ["url", "schema"],
      additionalProperties: false,
    },
  },
  {
    name: "list_templates",
    description:
      "List the authenticated user's saved extraction templates / recipes. Returns id, name, and source URL for each.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "run_template",
    description: "Run a saved Stealth Scraper template by id against a target URL.",
    inputSchema: {
      type: "object",
      properties: {
        template_id: { type: "string" },
        url: { type: "string" },
      },
      required: ["template_id", "url"],
      additionalProperties: false,
    },
  },
];

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

function ok(payload: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function err(message: string, extras?: Record<string, unknown>): ToolResult {
  const body = extras ? { error: message, ...extras } : { error: message };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
  };
}

/**
 * Dispatch a single tool call. The MCP runtime hands us the tool name plus
 * its arguments — we look up the handler and return a result envelope.
 *
 * All errors are caught and converted to MCP error envelopes so the agent
 * model sees a structured failure response instead of a crashed server.
 */
export async function dispatch(
  client: StealthClient,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "scrape_url": {
        const url = String(args.url ?? "");
        const fields = typeof args.fields === "string" ? args.fields : "";
        if (!url) return err("missing required arg: url");
        if (fields) {
          const r = await client.assistExtract({ url, description: fields });
          return ok({
            url: r.url,
            title: r.title,
            template: r.template,
            fields: r.fields,
          });
        }
        const snap = await client.snapshot(url);
        return ok({
          url: snap.url,
          title: snap.title,
          element_count: snap.elementCount,
          elements: snap.elements.slice(0, 50), // cap to keep response small
        });
      }
      case "extract_structured": {
        const url = String(args.url ?? "");
        const schema = (args.schema ?? []) as TemplateField[];
        if (!url) return err("missing required arg: url");
        if (!Array.isArray(schema) || schema.length === 0)
          return err("missing required arg: schema (non-empty array)");
        const r = await client.extract({ url, template: schema });
        return ok({ url: r.url, title: r.title, fields: r.fields, errors: r.errors });
      }
      case "list_templates": {
        const templates = await client.listTemplates();
        return ok({
          count: templates.length,
          templates: templates.map((t) => ({
            id: t.id,
            name: t.name,
            source_url: t.sourceUrl,
            field_count: t.fields.length,
          })),
        });
      }
      case "run_template": {
        const templateId = String(args.template_id ?? "");
        const url = String(args.url ?? "");
        if (!templateId) return err("missing required arg: template_id");
        if (!url) return err("missing required arg: url");
        const r = await client.runTemplate(templateId, url);
        return ok({ url: r.url, title: r.title, fields: r.fields, errors: r.errors });
      }
      default:
        return err(`unknown tool: ${name}`);
    }
  } catch (e) {
    // Surface typed SDK errors with their structured fields so the model can
    // explain to the user *why* the scrape failed (anti-bot vendor, plan
    // cap, etc.). Falls back to message + name for everything else.
    const anyErr = e as {
      name?: string;
      message?: string;
      kind?: string;
      vendor?: string;
      suggestion?: string;
      used?: number;
      limit?: number;
      upgradeUrl?: string;
      retryAfterS?: number;
      statusCode?: number;
    };
    return err(anyErr.message ?? String(e), {
      type: anyErr.name,
      kind: anyErr.kind,
      vendor: anyErr.vendor,
      suggestion: anyErr.suggestion,
      used: anyErr.used,
      limit: anyErr.limit,
      upgrade_url: anyErr.upgradeUrl,
      retry_after_s: anyErr.retryAfterS,
      status_code: anyErr.statusCode,
    });
  }
}
