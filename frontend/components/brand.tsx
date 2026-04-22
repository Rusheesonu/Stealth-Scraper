import { cn } from "@/lib/utils";

export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative h-7 w-7">
        <div className="absolute inset-0 rounded-md bg-[var(--color-accent)]" />
        <div className="absolute inset-1 rounded-sm bg-black flex items-center justify-center">
          <span className="text-[var(--color-accent)] font-mono text-[10px] font-bold">SS</span>
        </div>
      </div>
      <div className="flex flex-col leading-none">
        <span className="text-sm font-semibold tracking-tight">Stealth-Scraper</span>
        <span className="text-[10px] text-[var(--color-muted)] font-mono">v2.0</span>
      </div>
    </div>
  );
}
