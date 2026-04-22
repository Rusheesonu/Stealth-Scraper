# Production container for the Stealth-Scraper backend.
#
# Designed to run on Hugging Face Spaces (Docker SDK): runs as uid 1000,
# listens on port 7860, and ships with a full Chrome install so nodriver
# can drive it. Works identically locally: `docker build -t stealth-scraper-api .`
# then `docker run -p 7860:7860 stealth-scraper-api`.

FROM python:3.12-slim

# ── System deps + Google Chrome ──────────────────────────────────────────
# nodriver drives a real Chrome binary, so we install the stable Google
# build. The font package prevents "no fonts" artifacts on screenshots.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        wget \
        gnupg \
        ca-certificates \
        fonts-liberation \
        fonts-noto-color-emoji \
        libnss3 \
        libxss1 \
        libasound2 \
    && wget -qO- https://dl.google.com/linux/linux_signing_key.pub \
        | gpg --dearmor > /etc/apt/trusted.gpg.d/google.gpg \
    && echo "deb [arch=amd64] https://dl.google.com/linux/chrome/deb/ stable main" \
        > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ── Non-root user (HF Spaces convention) ─────────────────────────────────
# HF runs containers as uid 1000. Create a matching user so files we
# write stay owned by that uid and Chrome sandbox paths work out.
RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:${PATH}"
WORKDIR /home/user/app

# ── Python deps ──────────────────────────────────────────────────────────
# Install deps before copying code so the layer caches across code changes.
COPY --chown=user requirements.txt .
RUN pip install --user --no-cache-dir --upgrade pip \
    && pip install --user --no-cache-dir -r requirements.txt

# ── Application ──────────────────────────────────────────────────────────
COPY --chown=user . .

# Ensure the SQLite data dir exists and is user-writable. On HF free tier
# this is ephemeral (resets on each rebuild) — templates don't persist
# across deploys. Add a persistent volume mount if you upgrade tiers.
RUN mkdir -p /home/user/app/data

# HF Spaces expects 7860 by default. Locally you can override by setting
# PORT when running.
ENV PORT=7860
EXPOSE 7860

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
