"use client";

/**
 * Review block — renders a star summary + the last N reviews for a
 * target. Used on landing (product-level), pricing (product-level),
 * and template detail pages (template-level).
 *
 * Falls back to seed reviews from /lib/seed-reviews.ts when API returns 0,
 * so the landing page never looks empty before real reviews accumulate.
 */

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, type Review, type ReviewSummary } from "@/lib/api";
import { SEED_PRODUCT_REVIEWS, SEED_PRODUCT_SUMMARY } from "@/lib/seed-reviews";
import { Star, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  targetKind: "product" | "template";
  targetId: string;
  /** Hide header (just show reviews). Defaults to false. */
  hideHeader?: boolean;
  /** Max reviews shown (default 6). */
  limit?: number;
  className?: string;
};

export function ReviewBlock({
  targetKind,
  targetId,
  hideHeader = false,
  limit = 6,
  className,
}: Props) {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.reviews.list(targetKind, targetId, limit).catch(() => null),
      api.reviews.summary(targetKind, targetId).catch(() => null),
    ]).then(([listRes, summaryRes]) => {
      if (!alive) return;
      const hasReal = listRes && listRes.reviews.length > 0;
      if (hasReal) {
        setReviews(listRes!.reviews);
        setSummary(summaryRes);
      } else if (targetKind === "product" && targetId === "stealth-scraper") {
        // Pre-launch fallback so the landing never looks empty.
        setReviews(SEED_PRODUCT_REVIEWS.slice(0, limit));
        setSummary(SEED_PRODUCT_SUMMARY);
      } else {
        setReviews([]);
        setSummary({ count: 0, avg: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [targetKind, targetId, limit]);

  if (loading) {
    return (
      <div className={cn("animate-pulse rounded-xl border bg-[var(--color-surface)] p-6", className)}>
        <div className="h-6 w-32 rounded bg-[var(--color-elevated)]" />
      </div>
    );
  }

  if (!reviews || reviews.length === 0) {
    return null; // no reviews + not the seed-eligible product → render nothing
  }

  return (
    <div className={cn("space-y-5", className)}>
      {!hideHeader && summary && (
        <div className="flex flex-wrap items-baseline gap-3">
          <div className="flex items-center gap-1">
            <StarRow value={summary.avg} />
            <span className="font-mono text-sm tabular-nums text-[var(--color-fg)]">
              {summary.avg.toFixed(1)}
            </span>
          </div>
          <span className="text-sm text-[var(--color-fg-subdued)]">
            {summary.count} {summary.count === 1 ? "review" : "reviews"}
          </span>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {reviews.map((r) => (
          <ReviewCard key={r.id} review={r} />
        ))}
      </div>
    </div>
  );
}

function ReviewCard({ review }: { review: Review }) {
  return (
    <Card className="flex h-full flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <StarRow value={review.rating} small />
        {review.verified && (
          <Badge className="inline-flex items-center gap-1 text-[10px]">
            <ShieldCheck className="h-3 w-3" />
            Verified
          </Badge>
        )}
      </div>
      <p className="flex-1 text-sm leading-relaxed text-[var(--color-fg)]">
        {review.body}
      </p>
      {review.author_name && (
        <div className="text-xs font-mono text-[var(--color-fg-subdued)]">
          — {review.author_name}
        </div>
      )}
    </Card>
  );
}

export function StarRow({ value, small = false }: { value: number; small?: boolean }) {
  const sz = small ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = value >= n - 0.25;
        const half = !filled && value >= n - 0.75;
        return (
          <Star
            key={n}
            className={cn(
              sz,
              filled
                ? "fill-amber-400 text-amber-400"
                : half
                  ? "fill-amber-200 text-amber-300"
                  : "text-[var(--color-border)]",
            )}
            strokeWidth={1.5}
          />
        );
      })}
    </span>
  );
}
