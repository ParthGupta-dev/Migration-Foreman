"use client";

// Overview flow scene — the "migration yard" rendered as a real 3D WebGL scene
// (react-three-fiber). Replaces the old hand-projected SVG isometric. Queued
// units pile in the Yard, ride the Conveyor to the Build bench (where low-poly
// workers hammer on them), pass the Gate to the Shipping dock + PR, or park on
// the Review siding when escalated. Driven by live campaign state via the same
// props the SVG version used (units / batches / onTokenClick) so the Overview
// page and its replay logic are unchanged.
//
// The heavy three.js scene lives in FlowSceneCanvas and is loaded client-only
// (ssr:false) — WebGL can't render on the server. A static fallback covers the
// no-WebGL / still-loading case so the card never collapses.

import dynamic from "next/dynamic";
import type { Unit } from "@/lib/types";
import type { Batch } from "@/lib/batches";

export interface FlowSceneProps {
  units: Unit[];
  batches: Batch[];
  onTokenClick: (batchId: string) => void;
}

const Canvas3D = dynamic(() => import("./FlowSceneCanvas"), {
  ssr: false,
  loading: () => <SceneFallback />,
});

export default function FlowScene(props: FlowSceneProps) {
  return (
    <div className="rounded-card border border-foreman-line bg-foreman-card shadow-card">
      <div className="relative h-[clamp(300px,40vw,440px)] w-full overflow-hidden rounded-card">
        <Canvas3D {...props} />
      </div>
    </div>
  );
}

function SceneFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <span className="text-sm text-foreman-faint">Loading the yard…</span>
    </div>
  );
}
