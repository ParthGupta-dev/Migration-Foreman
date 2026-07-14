"use client";

// TEMPORARY visual test harness for the 3D FlowScene — not part of the app.
// Feeds mock units across every status so all zones + workers render without a
// live campaign. Delete this route once the scene is verified.

import { useState } from "react";
import FlowScene from "@/components/overview/FlowScene";
import { deriveBatches } from "@/lib/batches";
import type { Unit, UnitStatus } from "@/lib/types";

function mk(id: string, dir: string, status: UnitStatus): Unit {
  return { unitId: id, scopeGlob: `${dir}/file${id}.py`, status, attempt: 1, diff: null, failureLog: null };
}

const SCENES: Record<string, Unit[]> = {
  mixed: [
    mk("1", "src", "passed"),
    mk("2", "src", "passed"),
    mk("3", "api", "running"),
    mk("4", "api", "retrying"),
    mk("5", "web", "escalated"),
    mk("6", "web", "pending"),
    mk("7", "core", "pending"),
    mk("8", "core", "pending"),
  ],
  running: [
    mk("1", "src", "running"),
    mk("2", "src", "running"),
    mk("3", "api", "pending"),
    mk("4", "api", "pending"),
    mk("5", "web", "passed"),
  ],
  done: [
    mk("1", "src", "passed"),
    mk("2", "src", "passed"),
    mk("3", "api", "passed"),
    mk("4", "api", "passed"),
  ],
  escalated: [
    mk("1", "src", "escalated"),
    mk("2", "src", "escalated"),
    mk("3", "api", "escalated"),
  ],
};

export default function SceneTest() {
  const [key, setKey] = useState<keyof typeof SCENES>("mixed");
  const units = SCENES[key];
  const batches = deriveBatches(units);
  return (
    <div className="mx-auto max-w-[1240px] p-8">
      <div className="mb-4 flex gap-2">
        {Object.keys(SCENES).map((k) => (
          <button
            key={k}
            onClick={() => setKey(k as keyof typeof SCENES)}
            className={`rounded-ctl border px-3 py-1.5 text-sm ${
              k === key ? "border-foreman-ink bg-foreman-ink text-foreman-card" : "border-foreman-line bg-foreman-card"
            }`}
          >
            {k}
          </button>
        ))}
      </div>
      <FlowScene units={units} batches={batches} onTokenClick={(b) => console.log("click batch", b)} />
    </div>
  );
}
