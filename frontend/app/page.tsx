"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { HealthResponse } from "@/lib/types";

// Phase 1 scaffold placeholder — replaced by the real landing composer
// (design/mocks/landing.html) in Phase 2.
export default function LandingPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-6">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-sm bg-foreman-accent" />
        <span className="font-ui font-bold tracking-wide">FOREMAN</span>
      </div>
      <p className="text-foreman-dim text-sm">
        Frontend scaffold — landing composer lands in Phase 2.
      </p>
      <p className="font-mono text-xs tabular-nums text-foreman-faint">
        {error ? `health check failed: ${error}` : health ? `backend: ${health.status} · llm: ${health.llm}` : "checking backend…"}
      </p>
    </main>
  );
}
