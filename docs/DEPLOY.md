# Deploy — Hugging Face Spaces + Vercel

End-state: your backend on `https://<you>-stealth-scraper.hf.space`, your
frontend on `https://stealth-scraper.vercel.app`, both free forever, no
credit card.

Total setup: ~10 minutes. Both sides autodetect most of it.

---

## 1 — Deploy the backend to Hugging Face Spaces

### 1a. Create the Space

1. Go to **https://huggingface.co/new-space**
2. Fill in:
   - **Owner:** your HF username
   - **Space name:** `stealth-scraper` (or whatever you like — this becomes the subdomain)
   - **Select the Space SDK:** **Docker** → **Blank** template
   - **Visibility:** Public
   - **Hardware:** CPU basic (free)
3. Click **Create Space**.

HF drops you into an empty repo page with a "Files" tab.

### 1b. Upload the backend files

You've got two options. Pick whichever matches your style:

#### Option A — Web UI (simpler, no CLI)

On the Space's Files tab, click **"+ Add file" → "Upload files"** and drop
in everything from this repo's `backend/` directory:

```
app/           (the whole folder — browser.py, main.py, snapshot.py, etc.)
Dockerfile
requirements.txt
run.py
```

Also upload **`deploy/hf-space-README.md`** from this repo, but **rename it to `README.md`** when uploading (HF Spaces need their specific YAML frontmatter at the top of README.md).

Click **"Commit changes to main"**.

#### Option B — git clone + push (faster if you deploy updates often)

```bash
# HF will give you the clone URL on the Space page — copy it. Example:
git clone https://huggingface.co/spaces/YOUR_USERNAME/stealth-scraper hf-space
cd hf-space

# Copy backend files from the main repo
cp -r ../Stealth-Scraper/backend/app .
cp ../Stealth-Scraper/backend/Dockerfile .
cp ../Stealth-Scraper/backend/requirements.txt .
cp ../Stealth-Scraper/backend/run.py .
cp ../Stealth-Scraper/backend/.dockerignore .
cp ../Stealth-Scraper/deploy/hf-space-README.md ./README.md

git add -A
git commit -m "Initial deploy"
git push
```

HF will ask for a username + token on push — use your HF username and
a **write** token from https://huggingface.co/settings/tokens.

### 1c. Wait for the build

Once you push/upload, HF starts building. Watch the **"App"** tab — it
shows live Docker build logs. First build takes **~4–6 minutes** (Chrome
install is the slow part).

When you see `Uvicorn running on http://0.0.0.0:7860` → you're live.

### 1d. Test

Your API is at:
```
https://YOUR_USERNAME-stealth-scraper.hf.space
```

Sanity checks:
```bash
curl https://YOUR_USERNAME-stealth-scraper.hf.space/health
# {"status":"ok","browser":false}

curl -X POST https://YOUR_USERNAME-stealth-scraper.hf.space/snapshot \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com"}' \
  | head -c 200
```

Save the base URL. You'll paste it into Vercel in the next step.

---

## 2 — Deploy the frontend to Vercel

### 2a. Import the GitHub repo

1. Go to **https://vercel.com/new**
2. Import **`Rusheesonu/Stealth-Scraper`** (Vercel will ask to install its
   GitHub app if you haven't already — approve just this repo)
3. In the **Configure Project** screen:
   - **Framework Preset:** Next.js (auto-detected)
   - **Root Directory:** click Edit → set to `frontend`
   - **Build Command:** leave default
   - **Output Directory:** leave default

### 2b. Set the backend env var

Still on the same Configure Project screen, expand **Environment Variables** and add:

| Name | Value |
|---|---|
| `BACKEND_URL` | `https://YOUR_USERNAME-stealth-scraper.hf.space` |

(Paste the HF URL from step 1d.)

Click **Deploy**. ~60-90 seconds.

### 2c. Test

Vercel gives you:
```
https://stealth-scraper-<hash>.vercel.app
```

(Or you can claim `stealth-scraper.vercel.app` on the Domains tab if it's free.)

Open it, paste `https://news.ycombinator.com` into the URL box, hit
Snapshot, click a headline, label it, Run Extract. If you see results,
you're live.

---

## 3 — Troubleshooting

### Backend build fails on HF
Check the App tab build logs. Most common causes:
- `requirements.txt` format issue → copy it directly from the repo without editing
- HF ran out of space during apt install → retry, HF occasionally has transient failures

### Backend builds but `/snapshot` returns 502
- Chrome might have failed to start. HF free tier CPU is shared — occasional flakes are normal. The retry loop I added (`is_transient_nodriver_error`) should catch most of these. If it persists, look at the "Logs" tab for the Space.

### Frontend works but "Snapshot failed" always
- Vercel `BACKEND_URL` is wrong. Go to Vercel → Project → Settings → Environment Variables. Fix it. Then Deployments → ⋯ → Redeploy (env var changes need a redeploy).

### "The Space is sleeping"
HF free tier naps aggressively but wakes on request. First request after
a sleep takes ~15–30s (Chrome cold start). Subsequent ones are normal speed.
For zero sleep, upgrade to HF Pro ($9/mo) or move to a paid Cloud Run / Fly.io setup.

---

## 4 — Updating the deploy

**Frontend:** push to `master` on GitHub → Vercel auto-deploys.

**Backend:** if you used Option B (git clone), push to the HF Space remote.
If you used Option A (web upload), repeat the upload — overwrite the
changed files.

For fully automated backend deploys, you can set up a GitHub Action that
pushes to the HF Space on every push to `master`. Add it later when this is
stable.
