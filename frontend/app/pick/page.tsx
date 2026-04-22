import { Suspense } from "react";
import { PickerClient } from "@/components/picker/picker-client";

export default function PickPage() {
  return (
    <Suspense fallback={<PickerFallback />}>
      <PickerClient />
    </Suspense>
  );
}

function PickerFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center text-[var(--color-muted)]">
      Loading picker…
    </div>
  );
}
