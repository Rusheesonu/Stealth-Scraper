/**
 * stealth-scraper: TypeScript SDK for the Stealth-Scraper API.
 *
 * ```ts
 * import { Client } from "stealth-scraper";
 *
 * const client = new Client();
 * const snap = await client.snapshot("https://example.com");
 * ```
 */

export { Client, StealthScraperError } from "./client.js";
export type {
  ClientOptions,
  TemplateField,
  TemplateFieldKind,
  SnapshotResponse,
  ExtractResponse,
  BatchExtractResponse,
  SavedTemplate,
  DetectedElement,
  ElementBbox,
} from "./client.js";

export const VERSION = "0.1.0";
