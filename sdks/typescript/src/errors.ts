/**
 * Typed error classes for the Stealth Scraper SDK.
 *
 * Mirrors the Python SDK so cross-language users get the same names. Each
 * subclass carries the structured fields the backend exposes for that
 * `kind`, so callers can branch on the failure mode they actually care
 * about instead of string-matching error messages.
 */

import type { ApiErrorDetail } from "./types.js";

export class StealthScraperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StealthScraperError";
  }
}

export interface ApiErrorOptions {
  statusCode?: number;
  kind?: string;
  detail?: ApiErrorDetail | string | null;
  requestId?: string;
}

export class ApiError extends StealthScraperError {
  public readonly statusCode: number;
  public readonly kind?: string;
  public readonly detail?: ApiErrorDetail | string | null;
  public readonly requestId?: string;

  constructor(message: string, opts: ApiErrorOptions = {}) {
    super(message);
    this.name = "ApiError";
    this.statusCode = opts.statusCode ?? 0;
    this.kind = opts.kind;
    this.detail = opts.detail;
    this.requestId = opts.requestId;
  }
}

export class AuthError extends ApiError {
  constructor(message: string, opts: ApiErrorOptions = {}) {
    super(message, opts);
    this.name = "AuthError";
  }
}

export class RateLimitError extends ApiError {
  public readonly retryAfterS?: number;

  constructor(
    message: string,
    opts: ApiErrorOptions & { retryAfterS?: number } = {},
  ) {
    super(message, opts);
    this.name = "RateLimitError";
    this.retryAfterS = opts.retryAfterS;
  }
}

export class AntiBotBlockError extends ApiError {
  public readonly vendor?: string;
  public readonly suggestion?: string;

  constructor(
    message: string,
    opts: ApiErrorOptions & { vendor?: string; suggestion?: string } = {},
  ) {
    super(message, opts);
    this.name = "AntiBotBlockError";
    this.vendor = opts.vendor;
    this.suggestion = opts.suggestion;
  }
}

export class PlanLimitError extends ApiError {
  public readonly used?: number;
  public readonly limit?: number;
  public readonly upgradeUrl?: string;

  constructor(
    message: string,
    opts: ApiErrorOptions & {
      used?: number;
      limit?: number;
      upgradeUrl?: string;
    } = {},
  ) {
    super(message, opts);
    this.name = "PlanLimitError";
    this.used = opts.used;
    this.limit = opts.limit;
    this.upgradeUrl = opts.upgradeUrl;
  }
}

export class OverloadedError extends ApiError {
  public readonly retryAfterS?: number;

  constructor(
    message: string,
    opts: ApiErrorOptions & { retryAfterS?: number } = {},
  ) {
    super(message, opts);
    this.name = "OverloadedError";
    this.retryAfterS = opts.retryAfterS;
  }
}

export class UnsafeUrlError extends ApiError {
  constructor(message: string, opts: ApiErrorOptions = {}) {
    super(message, opts);
    this.name = "UnsafeUrlError";
  }
}

/** Map of `detail.kind` strings to specific error constructors. */
type ApiErrorCtor = new (msg: string, opts: ApiErrorOptions) => ApiError;
export const KIND_TO_ERROR: Record<string, ApiErrorCtor> = {
  anti_bot_block: AntiBotBlockError as unknown as ApiErrorCtor,
  plan_limit: PlanLimitError as unknown as ApiErrorCtor,
  overloaded: OverloadedError as unknown as ApiErrorCtor,
  unsafe_url: UnsafeUrlError as unknown as ApiErrorCtor,
  robots_disallowed: UnsafeUrlError as unknown as ApiErrorCtor,
  rate_limit: RateLimitError as unknown as ApiErrorCtor,
};
