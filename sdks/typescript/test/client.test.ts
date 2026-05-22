/**
 * Vitest suite for the TypeScript SDK.
 *
 * Stubs `fetch` via the constructor's `fetch` option so the suite is fully
 * offline. Covers: header propagation, idempotency key auto-gen + override,
 * typed error envelopes, and 401/429 status-code fallbacks.
 */

import { describe, expect, it } from "vitest";
import {
  AntiBotBlockError,
  ApiError,
  AuthError,
  OverloadedError,
  PlanLimitError,
  RateLimitError,
  StealthClient,
} from "../src/index.js";

const SNAPSHOT_PAYLOAD = {
  url: "https://example.com/",
  title: "Example",
  screenshot: "iVBORw0KG...",
  viewport: { width: 1280, height: 800 },
  page: { description: "demo" },
  elements: [{ selector: "h1", text: "Hello" }],
  element_count: 1,
};

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function makeFetch(
  handler: (req: CapturedRequest) => { status?: number; body?: unknown; headers?: Record<string, string> },
  captured?: CapturedRequest[],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    const initHeaders = (init?.headers ?? {}) as Record<string, string>;
    for (const k of Object.keys(initHeaders)) headers[k.toLowerCase()] = initHeaders[k]!;
    const cap: CapturedRequest = {
      url: typeof input === "string" ? input : input.toString(),
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    if (captured) captured.push(cap);
    const { status = 200, body = {}, headers: respHeaders = {} } = handler(cap);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...respHeaders },
    });
  }) as unknown as typeof fetch;
}

describe("StealthClient — snapshot", () => {
  it("sends auth + auto-generated idempotency key", async () => {
    const captured: CapturedRequest[] = [];
    const client = new StealthClient({
      apiKey: "ssk_test",
      fetch: makeFetch(() => ({ body: SNAPSHOT_PAYLOAD }), captured),
    });
    const snap = await client.snapshot("https://example.com/");
    expect(snap.title).toBe("Example");
    expect(snap.elementCount).toBe(1);
    expect(captured[0]!.headers.authorization).toBe("Bearer ssk_test");
    expect(captured[0]!.headers["idempotency-key"]).toMatch(/^sdk-/);
    expect(captured[0]!.headers["user-agent"]).toMatch(/stealth-scraper-js/);
    expect(captured[0]!.body).toEqual({ url: "https://example.com/" });
  });

  it("passes explicit idempotency key through", async () => {
    const captured: CapturedRequest[] = [];
    const client = new StealthClient({
      apiKey: "ssk_test",
      fetch: makeFetch(() => ({ body: SNAPSHOT_PAYLOAD }), captured),
    });
    await client.snapshot({ url: "https://x", idempotencyKey: "run-42" });
    expect(captured[0]!.headers["idempotency-key"]).toBe("run-42");
  });
});

describe("StealthClient — extract", () => {
  it("requires template or templateId", async () => {
    const client = new StealthClient({
      apiKey: "ssk_test",
      fetch: makeFetch(() => ({ body: {} })),
    });
    await expect(client.extract({ url: "https://x" })).rejects.toThrow(/template/);
  });

  it("fetches template by id first when templateId given", async () => {
    const captured: CapturedRequest[] = [];
    const client = new StealthClient({
      apiKey: "ssk_test",
      fetch: makeFetch((req) => {
        if (req.url.endsWith("/templates/t_123")) {
          return {
            body: {
              id: "t_123",
              name: "demo",
              source_url: "https://x",
              fields: [{ name: "title", selector: "h1" }],
            },
          };
        }
        return { body: { url: "https://x", title: "X", fields: { title: "Hi" }, errors: {} } };
      }, captured),
    });
    const res = await client.extract({ url: "https://x", templateId: "t_123" });
    expect(res.fields).toEqual({ title: "Hi" });
    expect(captured.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "GET /templates/t_123",
      "POST /extract",
    ]);
  });
});

describe("StealthClient — error envelopes", () => {
  const mkClient = (status: number, detail: unknown, headers?: Record<string, string>) =>
    new StealthClient({
      apiKey: "ssk_test",
      fetch: makeFetch(() => ({ status, body: { detail }, headers })),
    });

  it("anti_bot_block → AntiBotBlockError with vendor", async () => {
    const c = mkClient(422, {
      kind: "anti_bot_block",
      message: "blocked",
      vendor: "cloudflare",
      suggestion: "use residential proxies",
    });
    try {
      await c.snapshot("https://x");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AntiBotBlockError);
      expect((e as AntiBotBlockError).vendor).toBe("cloudflare");
      expect((e as AntiBotBlockError).suggestion).toBe("use residential proxies");
      expect((e as AntiBotBlockError).statusCode).toBe(422);
    }
  });

  it("plan_limit → PlanLimitError with used/limit", async () => {
    const c = mkClient(402, {
      kind: "plan_limit",
      message: "cap reached",
      used: 1000,
      limit: 1000,
      upgrade_url: "https://stealthscraper.dev/upgrade",
    });
    try {
      await c.snapshot("https://x");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PlanLimitError);
      const pl = e as PlanLimitError;
      expect(pl.used).toBe(1000);
      expect(pl.limit).toBe(1000);
      expect(pl.upgradeUrl).toMatch(/upgrade/);
    }
  });

  it("overloaded → OverloadedError with retry_after_s", async () => {
    const c = mkClient(503, { kind: "overloaded", message: "queue", retry_after_s: 12 });
    try {
      await c.snapshot("https://x");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(OverloadedError);
      expect((e as OverloadedError).retryAfterS).toBe(12);
    }
  });

  it("401 without kind → AuthError", async () => {
    const c = mkClient(401, "invalid key");
    try {
      await c.snapshot("https://x");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
    }
  });

  it("429 uses Retry-After header", async () => {
    const c = mkClient(429, "slow down", { "retry-after": "7" });
    try {
      await c.snapshot("https://x");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
      expect((e as RateLimitError).retryAfterS).toBe(7);
    }
  });

  it("unmapped kind → generic ApiError", async () => {
    const c = mkClient(500, { kind: "something_new", message: "novel" });
    try {
      await c.snapshot("https://x");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).kind).toBe("something_new");
      expect((e as ApiError).statusCode).toBe(500);
    }
  });
});

describe("StealthClient — config", () => {
  it("throws if no apiKey and env unset", () => {
    const savedKey = process.env.STEALTH_SCRAPER_API_KEY;
    delete process.env.STEALTH_SCRAPER_API_KEY;
    try {
      expect(() => new StealthClient()).toThrow(/apiKey is required/);
    } finally {
      if (savedKey !== undefined) process.env.STEALTH_SCRAPER_API_KEY = savedKey;
    }
  });

  it("picks up env var", () => {
    const saved = process.env.STEALTH_SCRAPER_API_KEY;
    process.env.STEALTH_SCRAPER_API_KEY = "ssk_env";
    try {
      const c = new StealthClient({ fetch: makeFetch(() => ({ body: {} })) });
      expect(c).toBeTruthy();
    } finally {
      if (saved !== undefined) process.env.STEALTH_SCRAPER_API_KEY = saved;
      else delete process.env.STEALTH_SCRAPER_API_KEY;
    }
  });
});
