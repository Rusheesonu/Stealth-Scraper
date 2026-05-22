"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Key, Trash2, AlertTriangle, Check } from "lucide-react";
import { PageShell } from "@/components/nav";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type ApiKey } from "@/lib/api";
import { cn } from "@/lib/utils";

type Lang = "python" | "typescript" | "curl";

const SDK_TABS: { id: Lang; label: string; iconText: string }[] = [
  { id: "python", label: "Python", iconText: "py" },
  { id: "typescript", label: "TypeScript", iconText: "ts" },
  { id: "curl", label: "cURL", iconText: "$" },
];

function buildSnippets(apiKey: string): Record<Lang, string> {
  return {
    // SDK sources live at github.com/Rusheesonu/Stealth-Scraper/tree/master/sdks
    // until we publish to PyPI / npm (coming soon). Install from git in
    // the meantime — both pip and npm support git+https URLs natively.
    python: `# install from source until v1 hits PyPI:
# pip install git+https://github.com/Rusheesonu/Stealth-Scraper.git#subdirectory=sdks/python

from stealth_scraper import StealthClient

client = StealthClient(api_key="${apiKey}")
result = client.snapshot("https://news.ycombinator.com/")
print(result.elements[:3])`,
    typescript: `// install from source until v1 hits npm:
// npm install github:Rusheesonu/Stealth-Scraper#path:sdks/typescript

import { StealthClient } from 'stealth-scraper';

const client = new StealthClient({ apiKey: '${apiKey}' });
const result = await client.snapshot('https://news.ycombinator.com/');
console.log(result.elements.slice(0, 3));`,
    curl: `# Works today — the API itself is live.
curl -X POST https://api.stealthscraper.dev/snapshot \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://news.ycombinator.com/"}'`,
  };
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [justCreated, setJustCreated] = useState<{ name: string; key: string } | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [sdkTab, setSdkTab] = useState<Lang>("python");
  const [sdkCopied, setSdkCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<{ id: number; name: string } | null>(null);
  const [revoking, setRevoking] = useState(false);

  // Toast — same Apple-style floating pill the picker uses.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function flashToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  async function load() {
    setLoadError(null);
    try { setKeys(await api.apiKeys.list()); }
    catch (e) { setLoadError(e instanceof Error ? e.message : String(e)); }
  }
  useEffect(() => { void load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await api.apiKeys.create(newName.trim());
      setJustCreated({ name: created.name, key: created.key });
      setNewName("");
      await load();
    } catch (e) {
      flashToast("Failed to create key: " + (e instanceof Error ? e.message : String(e)));
    } finally { setCreating(false); }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await api.apiKeys.revoke(revokeTarget.id);
      await load();
      flashToast(`Revoked "${revokeTarget.name}"`);
      setRevokeTarget(null);
    } catch (e) {
      flashToast("Failed to revoke: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRevoking(false);
    }
  }

  async function copyKey() {
    if (!justCreated) return;
    try {
      await navigator.clipboard.writeText(justCreated.key);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1200);
    } catch {}
  }

  // SDK samples use the just-created key when available — proves it works
  // end-to-end. Otherwise we show the canonical ssk_xxx placeholder.
  const sampleKey = justCreated?.key ?? "ssk_xxx";
  const snippets = buildSnippets(sampleKey);

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippets[sdkTab]);
      setSdkCopied(true);
      setTimeout(() => setSdkCopied(false), 1200);
    } catch {}
  }

  return (
    <PageShell maxWidth="max-w-3xl">
      <div>
        <PageHeader
          eyebrow="Account · API keys"
          title="Programmatic access"
          description="Use these from your code, the Python SDK, the TypeScript SDK, or the MCP server."
          backHref="/"
          backLabel="Home"
        />

        {/* One-time reveal */}
        {justCreated && (
          <Card density="comfortable" className="mb-8 border-[color:var(--color-accent)]/40 bg-[var(--color-accent-faint)]">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-[var(--color-fg-strong)]">
              <Key className="h-4 w-4 text-[var(--color-accent)]" />
              Key created — copy now. This is the only time you&apos;ll see it.
            </div>
            <p className="mb-3 text-[12px] text-[var(--color-fg-muted)]">
              <strong className="text-[var(--color-fg)]">{justCreated.name}</strong> — store somewhere safe (1Password, env var).
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border border-[color:var(--color-accent)]/30 bg-[var(--color-bg)] px-3 py-2 font-mono text-[12px] text-[var(--color-fg)]">
                {justCreated.key}
              </code>
              <Button onClick={copyKey} variant="secondary" size="sm">
                {copyState === "copied" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copyState === "copied" ? "Copied" : "Copy"}
              </Button>
            </div>
            <button
              onClick={() => setJustCreated(null)}
              className="mt-4 text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:underline"
            >
              I&apos;ve saved it — dismiss
            </button>
          </Card>
        )}

        {/* Create form */}
        <form onSubmit={handleCreate} className="mb-8 flex gap-2">
          <Input
            type="text"
            placeholder='Label (e.g. "Production agent", "Local dev")'
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={60}
            size="md"
            className="flex-1"
          />
          <Button type="submit" variant="primary" size="md" disabled={creating || !newName.trim()}>
            {creating ? "Creating…" : "Create key"}
          </Button>
        </form>

        {/* List */}
        {loadError && (
          <Card density="compact" className="border-[color:var(--color-danger)]/30 text-[13px] text-[color:var(--color-danger)]">
            <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
            Couldn&apos;t load your keys: {loadError}
          </Card>
        )}

        {keys && keys.length === 0 && !loadError && (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] p-12 text-center">
            <Key className="mx-auto mb-3 h-5 w-5 text-[var(--color-fg-subdued)]" />
            <div className="text-[14px] font-medium text-[var(--color-fg)]">No API keys yet</div>
            <p className="mt-1.5 text-[12px] text-[var(--color-fg-muted)]">
              Create one above to start calling Stealth-Scraper from your code.
            </p>
          </div>
        )}

        {keys && keys.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full">
              <thead>
                <tr className="bg-[var(--color-surface)]">
                  <th className="px-4 py-2.5 text-left text-[11px] font-mono font-medium uppercase tracking-wider text-[var(--color-fg-subdued)]">Name</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-mono font-medium uppercase tracking-wider text-[var(--color-fg-subdued)]">Prefix</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-mono font-medium uppercase tracking-wider text-[var(--color-fg-subdued)]">Created</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-mono font-medium uppercase tracking-wider text-[var(--color-fg-subdued)]">Last used</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-mono font-medium uppercase tracking-wider text-[var(--color-fg-subdued)]"></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const revoked = !!k.revoked_at;
                  return (
                    <tr key={k.id} className={cn("border-t border-[var(--color-border)]", revoked && "opacity-50")}>
                      <td className="px-4 py-3">
                        <div className="text-[13px] font-medium text-[var(--color-fg)]">{k.name}</div>
                        {revoked && (
                          <div className="mt-0.5 font-mono text-[10px] text-[color:var(--color-danger)]">
                            revoked {timeAgo(k.revoked_at!)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-[var(--color-fg-muted)]">{k.prefix}…</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-[var(--color-fg-muted)]">{timeAgo(k.created_at)}</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-[var(--color-fg-muted)]">
                        {k.last_used_at ? timeAgo(k.last_used_at) : "never"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!revoked && (
                          <Button onClick={() => setRevokeTarget({ id: k.id, name: k.name })} variant="danger" size="sm">
                            <Trash2 className="h-3 w-3" />
                            Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* SDK samples — tabbed. Uses justCreated.key when available so the
            sample is copy-paste-runnable right after creation. */}
        <div className="mt-10 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-ink-1)] px-3 py-2">
            <div className="flex items-center gap-0.5">
              {SDK_TABS.map(({ id, label, iconText }) => {
                const active = sdkTab === id;
                return (
                  <button
                    key={id}
                    onClick={() => setSdkTab(id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium",
                      "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                      active
                        ? "bg-[var(--color-surface)] text-[var(--color-fg-strong)] ring-1 ring-[var(--color-border)]"
                        : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
                    )}
                  >
                    <span className={cn(
                      "inline-flex h-4 w-4 items-center justify-center rounded-sm font-mono text-[9px]",
                      active
                        ? "bg-[var(--color-accent-faint)] text-[var(--color-accent)] ring-1 ring-inset ring-[var(--color-accent-line)]"
                        : "bg-[var(--color-ink-2)] text-[var(--color-fg-muted)]",
                    )}>
                      {iconText}
                    </span>
                    {label}
                  </button>
                );
              })}
            </div>
            <button
              onClick={copySnippet}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-[10.5px] text-[var(--color-fg-muted)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-fg)]"
              title="Copy snippet"
            >
              {sdkCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {sdkCopied ? "copied" : "copy"}
            </button>
          </div>
          <pre className="overflow-x-auto bg-[var(--color-ink-1)] px-5 py-4 font-mono text-[12px] leading-[1.65] text-[var(--color-fg)]">
{snippets[sdkTab]}
          </pre>
          {!justCreated && (
            <div className="border-t border-[var(--color-border)] bg-[var(--color-ink-1)] px-5 py-2.5 font-mono text-[10.5px] text-[var(--color-fg-subdued)]">
              Replace <code>ssk_xxx</code> with the key shown when you create one above.
            </div>
          )}
          {justCreated && (
            <div className="border-t border-[color:var(--color-accent)]/30 bg-[var(--color-accent-faint)] px-5 py-2.5 font-mono text-[10.5px] text-[var(--color-fg-muted)]">
              Snippet contains your new key — copy and save it now.
            </div>
          )}
        </div>
      </div>

      {/* Revoke confirmation modal — no native confirm(). */}
      {revokeTarget && (
        <ConfirmModal
          title={`Revoke "${revokeTarget.name}"?`}
          body="This cannot be undone. Any clients using this key will start getting 401."
          confirmLabel={revoking ? "Revoking…" : "Revoke"}
          cancelLabel="Cancel"
          busy={revoking}
          onConfirm={confirmRevoke}
          onCancel={() => (revoking ? undefined : setRevokeTarget(null))}
        />
      )}

      {/* Toast — Apple-style floating pill, same chrome as picker. */}
      {toast && (
        <div
          className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full px-4 py-2 font-mono text-[12px] text-white shadow-[var(--shadow-popover)]"
          style={{
            background: "color-mix(in srgb, var(--color-ink-9) 92%, transparent)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          }}
        >
          {toast}
        </div>
      )}
    </PageShell>
  );
}

/**
 * Inline confirm modal — backdrop + dialog. We don't have a generic Dialog
 * primitive yet so this lives here. Keep semantics identical to confirm():
 * one destructive action, one cancel, and Esc / backdrop click cancels.
 */
function ConfirmModal({
  title,
  body,
  confirmLabel,
  cancelLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div
        className="absolute inset-0 bg-[color:var(--color-ink-9)]/60 backdrop-blur-sm"
        onClick={() => (busy ? undefined : onCancel())}
        aria-hidden
      />
      <div className="relative w-full max-w-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-popover)]">
        <div className="mb-1.5 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-[color:var(--color-danger)]" />
          <h2 id="confirm-title" className="text-[14px] font-semibold tracking-tight text-[var(--color-fg-strong)]">
            {title}
          </h2>
        </div>
        <p className="mb-5 text-[13px] leading-[1.5] text-[var(--color-fg-muted)]">{body}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="md" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant="danger" size="md" onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const sec = Math.max(1, Math.floor((Date.now() - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
