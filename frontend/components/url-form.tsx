"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowRight, Loader2 } from "lucide-react";

export function UrlForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    let value = url.trim();
    if (!value) return;
    if (!/^https?:\/\//i.test(value)) value = "https://" + value;
    setBusy(true);
    router.push(`/pick?url=${encodeURIComponent(value)}`);
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://news.ycombinator.com"
        className="h-12 text-base"
        inputMode="url"
        autoFocus
      />
      <Button type="submit" size="lg" disabled={busy || !url.trim()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
        Snapshot
      </Button>
    </form>
  );
}
