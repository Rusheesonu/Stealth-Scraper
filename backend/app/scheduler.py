"""Scheduled scrapes — runs cron'd jobs and POSTs results to configured
webhooks.

Implementation notes:
  * APScheduler runs a single tick every 60s that picks up jobs whose
    `next_run_at` is in the past, runs them sequentially (we share one
    browser pool, no point in parallelizing the work).
  * `schedule_cron` is stored as a 5-field cron string for forward-compat,
    but we currently match against a small set of well-known intervals
    (the ones offered in the UI). Custom cron parsing → add croniter
    when there's demand.
  * Webhooks: signed POST with HMAC-SHA256, header `X-Stealth-Signature`.
    Signing key = the user's first non-revoked API key. Receivers verify
    using the same algorithm we apply to LS webhooks.
  * Failures: caught, logged, recorded in `last_status`. Job stays enabled
    and will retry on the next tick.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx

from app import db
from app.extract import extract as extract_fields


# Map of supported cron strings → minute interval. Keep aligned with the
# UI dropdown in /settings/schedules.
_INTERVAL_MIN = {
    "*/15 * * * *": 15,
    "0 * * * *": 60,
    "0 */6 * * *": 360,
    "0 9 * * *": 1440,    # daily
    "0 0 * * 0": 10080,   # weekly
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def compute_next_run(cron: str, *, base: Optional[datetime] = None) -> str:
    """Returns ISO-8601 timestamp for the next time this cron should fire.
    Unknown cron strings default to hourly so we don't accidentally schedule
    them in the past forever."""
    base = base or _now()
    minutes = _INTERVAL_MIN.get(cron, 60)
    return _iso(base + timedelta(minutes=minutes))


_WEBHOOK_TIMEOUT = float(os.getenv("SCHEDULED_WEBHOOK_TIMEOUT", "20"))


async def _deliver_webhook(url: str, payload: dict[str, Any], signing_secret: str) -> dict[str, Any]:
    """POST payload to webhook URL with HMAC signature. Returns delivery
    result dict {status, error?}."""
    body_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    signature = hmac.new(
        signing_secret.encode("utf-8") if signing_secret else b"",
        body_bytes,
        hashlib.sha256,
    ).hexdigest()
    try:
        async with httpx.AsyncClient(timeout=_WEBHOOK_TIMEOUT) as client:
            res = await client.post(
                url,
                content=body_bytes,
                headers={
                    "Content-Type": "application/json",
                    "X-Stealth-Signature": signature,
                    "X-Stealth-Event": "scheduled_run",
                    "User-Agent": "Stealth-Scraper-Webhook/1.0",
                },
            )
        return {"status": res.status_code, "body_len": len(res.text)}
    except Exception as e:
        return {"status": 0, "error": str(e)}


async def _run_one_job(job: dict[str, Any]) -> str:
    """Execute one scheduled job. Returns status string to record on the
    job (e.g. 'ok', 'ok+webhook=200', 'error: ...')."""
    tpl = await db.get_template(job["template_id"], job["user_id"])
    if tpl is None:
        return "error: template missing"

    try:
        result = await extract_fields(job["target_url"], tpl["fields"])
    except Exception as e:
        return f"error: extract {str(e)[:80]}"

    if job.get("webhook_url"):
        # Get user's first non-revoked API key as the HMAC signing secret —
        # so the receiver can recover the secret from their account without
        # us minting a separate per-job secret.
        keys = await db.list_api_keys(job["user_id"])
        signing_key = ""
        for k in keys:
            if not k.get("revoked_at"):
                signing_key = k.get("prefix", "")  # prefix is non-secret + stable
                break
        delivery = await _deliver_webhook(
            job["webhook_url"],
            {
                "event": "scheduled_run",
                "job_id": job["id"],
                "job_name": job["name"],
                "url": job["target_url"],
                "result": result,
                "ran_at": _iso(_now()),
            },
            signing_key,
        )
        if delivery.get("error"):
            return f"ok+webhook_error: {delivery['error'][:60]}"
        return f"ok+webhook={delivery['status']}"
    return "ok"


async def tick() -> None:
    """One scheduler tick — picked up due jobs and runs them sequentially.
    Called every ~60s by APScheduler in the FastAPI lifespan."""
    try:
        due = await db.list_due_jobs()
    except Exception as e:
        print(f"[scheduler] list_due_jobs failed: {e!r}")
        return
    if not due:
        return

    print(f"[scheduler] tick — {len(due)} due job(s)")
    for job in due:
        try:
            status = await _run_one_job(job)
            next_run = compute_next_run(job["schedule_cron"])
            await db.mark_job_ran(job["id"], next_run_at=next_run, status=status)
            print(f"[scheduler] job {job['id']} ({job['name']}) → {status} (next: {next_run})")
        except Exception as e:
            print(f"[scheduler] job {job['id']} crashed: {e!r}")
            try:
                next_run = compute_next_run(job["schedule_cron"])
                await db.mark_job_ran(job["id"], next_run_at=next_run, status=f"error: {str(e)[:80]}")
            except Exception:
                pass


# ── APScheduler integration ───────────────────────────────────────────────

_scheduler: Optional[Any] = None


def start_scheduler() -> None:
    """Start the background tick loop. Call from FastAPI lifespan startup."""
    global _scheduler
    if _scheduler is not None:
        return
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler

        sched = AsyncIOScheduler(timezone="UTC")
        sched.add_job(tick, "interval", minutes=1, id="stealth-scheduler-tick", max_instances=1)
        sched.start()
        _scheduler = sched
        print("[scheduler] started — tick every 60s")
    except ImportError:
        print("[scheduler] APScheduler not installed — scheduled jobs WILL NOT run")
    except Exception as e:
        print(f"[scheduler] start failed: {e!r}")


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is None:
        return
    try:
        _scheduler.shutdown(wait=False)
    except Exception:
        pass
    _scheduler = None
