"use client";

import { useEffect, useState } from "react";
import { Copy, Key, Trash2, AlertTriangle, Check } from "lucide-react";
import { PageShell } from "@/components/nav";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type ApiKey } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [justCreated, setJustCreated] = useState<{ name: string; key: string } | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

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
      alert("Failed to create key: " + (e instanceof Error ? e.message : String(e)));
    } finally { setCreating(false); }
  }

  async function handleRevoke(id: number, name: string) {
    if (!confirm(`Revoke "${name}"? Cannot be undone. Any clients using it will start getting 401.`)) return;
    try { await api.apiKeys.revoke(id); await load(); }
    catch (e) { alert("Failed to revoke: " + (e instanceof Error ? e.message : String(e))); }
  }

  async function copyKey() {
    if (!justCreated) return;
    try {
      await navigator.clipboard.writeText(justCreated.key);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1200);
    } catch {}
  }

  return (
    <PageShell maxWidth="max-w-3xl">
      <div className="py-12">
        <div className="mb-10">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">Account · API keys</div>
          <h1 className="text-[28px] font-semibold tracking-[-0.015em] text-[var(--color-fg-strong)]">
            Programmatic access
          </h1>
          <p className="mt-2 text-[13px] text-[var(--color-fg-muted)]">
            Use these from your code, the Python SDK, the TypeScript SDK, or the MCP server.
          </p>
        </div>

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
                          <Button onClick={() => handleRevoke(k.id, k.name)} variant="danger" size="sm">
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

        {/* Curl example */}
        <Card density="compact" className="mt-10">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">Using your key</div>
          <pre className="overflow-x-auto rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3 font-mono text-[11px] text-[var(--color-fg)]">
{`curl -X POST https://stealthscraper.dev/api/backend/snapshot \\
  -H "Authorization: Bearer ssk_..." \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com"}'`}
          </pre>
        </Card>
      </div>
    </PageShell>
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
