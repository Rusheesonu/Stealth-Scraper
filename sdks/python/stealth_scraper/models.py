"""Result dataclasses returned from SDK methods.

These are intentionally permissive — the backend response shape may grow
new fields over time and we want SDK upgrades to be additive, never breaking.
Unknown keys are preserved in `.raw` so callers can reach for forward-compat
fields without waiting on an SDK release.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class SnapshotResult:
    """Result from `client.snapshot(...)`."""

    url: str
    title: str
    screenshot: str  # base64-encoded PNG
    viewport: dict[str, int]
    page: dict[str, Any]
    elements: list[dict[str, Any]]
    element_count: int
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_response(cls, data: dict[str, Any]) -> SnapshotResult:
        return cls(
            url=data.get("url", ""),
            title=data.get("title", ""),
            screenshot=data.get("screenshot", ""),
            viewport=data.get("viewport", {}),
            page=data.get("page", {}),
            elements=data.get("elements", []),
            element_count=data.get("element_count", len(data.get("elements", []))),
            raw=data,
        )


@dataclass
class ExtractResult:
    """Result from `client.extract(...)` and `run_template(...)`."""

    url: str
    title: str
    fields: dict[str, Any]
    errors: dict[str, str] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_response(cls, data: dict[str, Any]) -> ExtractResult:
        return cls(
            url=data.get("url", ""),
            title=data.get("title", ""),
            fields=data.get("fields", {}),
            errors=data.get("errors", {}) or {},
            raw=data,
        )


@dataclass
class AssistExtractResult:
    """Result from `client.assist_extract(...)` — generated template + values."""

    url: str
    title: str
    description: str
    template: list[dict[str, Any]]
    fields: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_response(cls, data: dict[str, Any]) -> AssistExtractResult:
        return cls(
            url=data.get("url", ""),
            title=data.get("title", ""),
            description=data.get("description", ""),
            template=data.get("template", []),
            fields=data.get("fields", {}),
            raw=data,
        )


@dataclass
class EstimateResult:
    """Result from `client.estimate(...)` — cost preview before running."""

    estimated_credits: float
    estimated_usd: float
    plan_credits_remaining: int | None = None
    breakdown: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_response(cls, data: dict[str, Any]) -> EstimateResult:
        return cls(
            estimated_credits=float(data.get("estimated_credits", 0)),
            estimated_usd=float(data.get("estimated_usd", 0.0)),
            plan_credits_remaining=data.get("plan_credits_remaining"),
            breakdown=data.get("breakdown", {}),
            raw=data,
        )


@dataclass
class SnapshotProgress:
    """One event from `async client.snapshot_stream(...)`.

    `event` is one of: "queued", "navigating", "rendering", "extracting",
    "done", "error". When `event == "done"`, `result` holds the final
    SnapshotResult."""

    event: str
    message: str = ""
    progress: float = 0.0  # 0.0–1.0
    result: SnapshotResult | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class Template:
    """A saved extraction template / recipe."""

    id: str
    name: str
    source_url: str
    fields: list[dict[str, Any]]
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_response(cls, data: dict[str, Any]) -> Template:
        return cls(
            id=str(data.get("id", "")),
            name=data.get("name", ""),
            source_url=data.get("source_url", ""),
            fields=data.get("fields", []),
            raw=data,
        )
