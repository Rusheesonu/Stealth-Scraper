"use client";

import { useEffect, useState } from "react";
import { Copy, Key, Trash2, AlertTriangle } from "lucide-react";
import { Nav } from "@/components/nav";
import { api, type ApiKey } from "@/lib/api";

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [justCreated, setJustCreated] = useState<{ name: string; key: string } | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  async function load() {
    setLoadError(null);
    try {
      const list = await api.apiKeys.list();
      setKeys(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

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
      alert("Failed to create key: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: number, name: string) {
    if (!confirm(`Revoke API key "${name}"? This cannot be undone. Any clients using it will start getting 401.`)) {
      return;
    }
    try {
      await api.apiKeys.revoke(id);
      await load();
    } catch (e) {
      alert("Failed to revoke: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function copyKey() {
    if (!justCreated) return;
    try {
      await navigator.clipboard.writeText(justCreated.key);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1500);
    } catch {
      // clipboard API can fail in some browsers / contexts
    }
  }

  return (
    <main className="min-h-screen">
      <Nav />
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-semibold tracking-tight">API keys</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Use these to call the Stealth-Scraper API from your code, the Python
            SDK, or the MCP server. Keep them secret.
          </p>
        </div>

        {/* One-time key reveal banner */}
        {justCreated && (
          <div className="mb-8 rounded-lg border border-emerald-700 bg-emerald-950/30 p-6">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-300">
              <Key className="h-4 w-4" />
              Key created — copy now, this is the only time you&apos;ll see it
            </div>
            <p className="mb-3 text-xs text-[var(--color-muted)]">
              <strong className="text-[var(--color-fg)]">{justCreated.name}</strong> — store this somewhere safe (1Password, env var, etc).
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded border border-emerald-900 bg-black px-3 py-2 font-mono text-xs text-emerald-200">
                {justCreated.key}
              </code>
              <button
                type="button"
                onClick={copyKey}
                className="flex items-center gap-1.5 rounded-md border border-emerald-800 bg-emerald-950/50 px-3 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-900/50"
              >
                <Copy className="h-3.5 w-3.5" />
                {copyState === "copied" ? "Copied" : "Copy"}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setJustCreated(null)}
              className="mt-4 text-xs text-emerald-400 hover:underline"
            >
              I&apos;ve saved it — dismiss
            </button>
          </div>
        )}

        {/* Create form */}
        <form
          onSubmit={handleCreate}
          className="mb-10 flex gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]/40 p-4"
        >
          <input
            type="text"
            placeholder='Label (e.g. "Production agent", "Local dev")'
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={60}
            className="flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-600"
          />
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-zinc-900 hover:opacity-90 disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create key"}
          </button>
        </form>

        {/* List */}
        {loadError && (
          <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">
            <AlertTriangle className="mr-1.5 inline h-4 w-4" />
            Couldn&apos;t load your keys: {loadError}
          </div>
        )}

        {keys && keys.length === 0 && !loadError && (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] p-12 text-center text-sm text-[var(--color-muted)]">
            No API keys yet. Create one above to call Stealth-Scraper from your
            code or wire it into Claude Desktop via the MCP server.
          </div>
        )}

        {keys && keys.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-panel)]/60 text-xs uppercase tracking-wider text-[var(--color-muted)]">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Name</th>
                  <th className="px-4 py-2.5 text-left font-medium">Prefix</th>
                  <th className="px-4 py-2.5 text-left font-medium">Created</th>
                  <th className="px-4 py-2.5 text-left font-medium">Last used</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const revoked = !!k.revoked_at;
                  return (
                    <tr
                      key={k.id}
                      className={`border-t border-[var(--color-border)] ${
                        revoked ? "opacity-40" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{k.name}</div>
                        {revoked && (
                          <div className="mt-0.5 text-xs text-red-300">
                            revoked {timeAgo(k.revoked_at!)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--color-muted)]">
                        {k.prefix}…
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--color-muted)]">
                        {timeAgo(k.created_at)}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--color-muted)]">
                        {k.last_used_at ? timeAgo(k.last_used_at) : "never"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!revoked && (
                          <button
                            type="button"
                            onClick={() => handleRevoke(k.id, k.name)}
                            className="inline-flex items-center gap-1 rounded-md border border-red-900 bg-red-950/30 px-2.5 py-1 text-xs text-red-200 hover:bg-red-900/50"
                          >
                            <Trash2 className="h-3 w-3" />
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Usage hint */}
        <div className="mt-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]/30 p-4 text-xs text-[var(--color-muted)]">
          <div className="mb-1.5 font-medium text-[var(--color-fg)]">Using your key</div>
          <code className="block whitespace-pre-wrap break-all font-mono text-[11px]">
{`curl -X POST https://stealthscraper.dev/api/backend/snapshot \\
  -H "Authorization: Bearer ssk_..." \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com"}'`}
          </code>
        </div>
      </div>
    </main>
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
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
