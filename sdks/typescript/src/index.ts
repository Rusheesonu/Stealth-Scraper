/**
 * Public entry point — re-exports the client and types.
 */

export { StealthClient } from "./client.js";
export type {
  StealthClientOptions,
  RequestOptions,
  BrowserAction,
  SnapshotRequest,
  SnapshotResult,
  TemplateField,
  ExtractRequest,
  ExtractResult,
  AssistExtractRequest,
  AssistExtractResult,
  EstimateRequest,
  EstimateResult,
  Template,
  SnapshotProgress,
  SnapshotProgressEvent,
  ApiErrorDetail,
} from "./types.js";

export {
  StealthScraperError,
  ApiError,
  AuthError,
  RateLimitError,
  AntiBotBlockError,
  PlanLimitError,
  OverloadedError,
  UnsafeUrlError,
} from "./errors.js";

export const VERSION = "0.1.0";
