"""Typed exceptions for the Stealth Scraper SDK.

The backend returns structured 4xx envelopes shaped like::

    {"detail": {"kind": "anti_bot_block", "vendor": "cloudflare", ...}}

This module maps each `kind` to a specific subclass so callers can catch
the exact failure mode they care about instead of brittle string matching
on error messages. Generic / unmapped failures fall back to ApiError.
"""

from __future__ import annotations

from typing import Any


class StealthScraperError(Exception):
    """Base class. Catch this if you want to handle anything from the SDK."""


class ApiError(StealthScraperError):
    """A non-2xx response from the API that didn't map to a more specific class.

    Attributes:
        status_code: HTTP status code returned by the API.
        kind: Backend-provided machine-readable error kind, if any.
        message: Human-readable message.
        detail: Raw detail payload from the response (dict or str).
        request_id: Server request ID for support inquiries, if present.
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: int = 0,
        kind: str | None = None,
        detail: Any = None,
        request_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.kind = kind
        self.message = message
        self.detail = detail
        self.request_id = request_id

    def __repr__(self) -> str:
        return (
            f"{type(self).__name__}(status_code={self.status_code}, "
            f"kind={self.kind!r}, message={self.message!r})"
        )


class AuthError(ApiError):
    """401/403 — missing, invalid, or revoked API key."""


class RateLimitError(ApiError):
    """429 — you've hit a rate limit. Inspect `retry_after_s` to back off."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int = 429,
        retry_after_s: float | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(message, status_code=status_code, **kwargs)
        self.retry_after_s = retry_after_s


class AntiBotBlockError(ApiError):
    """422 with kind=anti_bot_block — the target site's anti-bot system blocked us.

    Attributes:
        vendor: e.g. "cloudflare", "datadome", "akamai", "perimeterx".
        suggestion: backend-provided hint for the operator.
    """

    def __init__(
        self,
        message: str,
        *,
        vendor: str | None = None,
        suggestion: str | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(message, **kwargs)
        self.vendor = vendor
        self.suggestion = suggestion


class PlanLimitError(ApiError):
    """402/422 with kind=plan_limit — monthly/quota cap exceeded.

    Attributes:
        used: requests used this period.
        limit: plan cap.
        upgrade_url: where to send the user to upgrade.
    """

    def __init__(
        self,
        message: str,
        *,
        used: int | None = None,
        limit: int | None = None,
        upgrade_url: str | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(message, **kwargs)
        self.used = used
        self.limit = limit
        self.upgrade_url = upgrade_url


class OverloadedError(ApiError):
    """503 with kind=overloaded — backend is at capacity; retry later.

    Attributes:
        retry_after_s: server-suggested back-off seconds.
    """

    def __init__(
        self,
        message: str,
        *,
        retry_after_s: float | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(message, **kwargs)
        self.retry_after_s = retry_after_s


class UnsafeUrlError(ApiError):
    """422 with kind=unsafe_url — SSRF guard or robots.txt blocked the request."""


# Map of `detail.kind` strings to specific exception classes. Kept as a
# module-level dict so it's easy for downstream code to extend if the
# backend grows new kinds before the SDK does.
KIND_TO_EXC: dict[str, type[ApiError]] = {
    "anti_bot_block": AntiBotBlockError,
    "plan_limit": PlanLimitError,
    "overloaded": OverloadedError,
    "unsafe_url": UnsafeUrlError,
    "robots_disallowed": UnsafeUrlError,
    "rate_limit": RateLimitError,
}
