"use client";

// Overview flow scene (frontend_refactor.md Phase 6, mock: design/mocks/
// overview.html). An isometric "migration yard": queued units pile in the Yard,
// ride the Conveyor to the Build bench (hammering / testing), pass the Gate to
// the Shipping dock, or park on the Review siding when escalated. Ported from
// the mock's SVG builders + projection; driven by real campaign state instead
// of the mock's canned scenes. Blocks carry their batch category colour the
// whole journey; status rides on top as a floating badge + which zone the block
// sits in. GSAP tweens the moves; prefers-reduced-motion snaps instead.

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import type { Unit, UnitStatus } from "@/lib/types";
import type { Batch } from "@/lib/batches";
import { batchForUnit, isBlockedStatus } from "@/lib/batches";

const SVGNS = "http://www.w3.org/2000/svg";
const C = 0.866;
const S = 0.29;

function P(x: number, y: number, z = 0): [number, number] {
  return [(x - y) * C, (x + y) * S - z];
}
function pts(list: [number, number][]): string {
  return list.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
}
function el(name: string, attrs: Record<string, string | number>, parent?: Element): SVGElement {
  const n = document.createElementNS(SVGNS, name);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(n);
  return n as SVGElement;
}

// zone geometry (from the mock)
const BELT_Y = 240, BELT_X0 = 150, BELT_X1 = 430;
const BENCH_X = 445, BENCH_Y = 150, BENCH_W = 130, BENCH_D = 150, BENCH_H = 26;
const BENCH_TOP = BENCH_H + 2;
const BENCH_SLOTS = [175, 235, 290];
const RETURN_Y = 340;
const DOCK_X = 720, DOCK_Y = 150;
const SIDING_X = 470, SIDING_Y = 430;
const YARD_H = 12, DOCK_H = 14, SIDING_H = 12;
const PILE_SPOTS: [number, number][] = [[-40, 120], [-40, 200], [-40, 280], [45, 120], [45, 200], [45, 280]];

const HEX = { ok: "#7C9463", run: "#3D362D", retry: "#B8894F", fail: "#B15D48", queued: "#8A8072" };
const BADGE_FILL: Record<string, string> = { ok: "#1A7F37", fail: "#CF222E", retry: "#B8894F", run: "#3D362D" };

function prism(parent: Element, x: number, y: number, z0: number, w: number, d: number, h: number, cls = "") {
  const t = z0 + h;
  const g = el("g", { class: "prism" + (cls ? " " + cls : "") }, parent);
  el("polygon", { class: "f-left", points: pts([P(x, y + d, t), P(x + w, y + d, t), P(x + w, y + d, z0), P(x, y + d, z0)]) }, g);
  el("polygon", { class: "f-right", points: pts([P(x + w, y, t), P(x + w, y + d, t), P(x + w, y + d, z0), P(x + w, y, z0)]) }, g);
  el("polygon", { class: "f-top", points: pts([P(x, y, t), P(x + w, y, t), P(x + w, y + d, t), P(x, y + d, t)]) }, g);
  return g;
}
function flat(parent: Element, x: number, y: number, w: number, d: number, cls = "") {
  return el("polygon", { class: "flat" + (cls ? " " + cls : ""), points: pts([P(x, y, 2), P(x + w, y, 2), P(x + w, y + d, 2), P(x, y + d, 2)]) }, parent);
}
function belt(parent: Element, x0: number, x1: number, y: number, id: string, rev = false) {
  flat(parent, x0, y - 14, x1 - x0, 34, "belt");
  const cp = el("clipPath", { id }, parent);
  el("polygon", { points: pts([P(x0, y - 14, 2), P(x1, y - 14, 2), P(x1, y + 20, 2), P(x0, y + 20, 2)]) }, cp);
  const clipG = el("g", { "clip-path": `url(#${id})` }, parent);
  const g = el("g", { class: "belt-flow" + (rev ? " rev" : "") }, clipG);
  const tip = rev ? -14 : 14;
  const CHEV = 34;
  for (let bx = x0 - CHEV; bx < x1 + CHEV; bx += CHEV) {
    const a = P(bx, y - 12, 3), b = P(bx + tip, y + 3, 3), c = P(bx, y + 18, 3);
    el("path", { class: "belt-chevron", d: `M${a[0]} ${a[1]} L${b[0]} ${b[1]} L${c[0]} ${c[1]}` }, g);
  }
}
function label(parent: Element, x: number, y: number, z: number, text: string) {
  const p = P(x, y, z);
  const t = el("text", { class: "scene-label", x: p[0], y: p[1] }, parent);
  t.textContent = text;
}
function wallLabel(parent: Element, x: number, y: number, w: number, d: number, h: number, text: string) {
  const p = P(x + w * 0.14, y + d, h * 0.3);
  const t = el("text", { class: "wall-label", transform: `matrix(${C},${S},0,1,${p[0].toFixed(1)},${p[1].toFixed(1)})` }, parent);
  t.textContent = text;
}

function visualStatus(status: UnitStatus): "ok" | "run" | "retry" | "fail" | "queued" {
  if (status === "passed") return "ok";
  if (status === "running") return "run";
  if (status === "retrying" || status === "failed") return "retry";
  if (status === "escalated" || isBlockedStatus(status)) return "fail";
  return "queued";
}

interface TokenRec {
  g: SVGElement;
  batchId: string;
}

export default function FlowScene({
  units,
  batches,
  onTokenClick,
}: {
  units: Unit[];
  batches: Batch[];
  onTokenClick: (batchId: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tokensRef = useRef<Map<string, TokenRec>>(new Map());
  const gateLampRef = useRef<SVGElement | null>(null);
  const prRef = useRef<SVGElement | null>(null);
  const builtRef = useRef(false);
  const clickRef = useRef(onTokenClick);
  clickRef.current = onTokenClick;

  // Build the static scene once.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || builtRef.current) return;
    builtRef.current = true;

    const gPaths = el("g", { id: "paths" }, svg);
    const gStations = el("g", { id: "stations" }, svg);
    el("g", { id: "tokens" }, svg); // tokens layer
    const gLabels = el("g", { id: "labels" }, svg);

    prism(gStations, -58, 100, 0, 150, 215, YARD_H);
    belt(gPaths, BELT_X0, BELT_X1, BELT_Y, "belt1");
    prism(gStations, BENCH_X, BENCH_Y, 0, BENCH_W, BENCH_D, BENCH_H);
    const gl = P(BENCH_X + BENCH_W + 16, BELT_Y, BENCH_TOP + 20);
    gateLampRef.current = el("circle", { class: "gate-lamp", cx: gl[0], cy: gl[1], r: 5, fill: HEX.run }, gStations);
    belt(gPaths, BENCH_X + BENCH_W, DOCK_X + 8, BELT_Y, "belt2");
    belt(gPaths, BELT_X0, 600, RETURN_Y, "belt3", true);
    prism(gStations, DOCK_X, DOCK_Y, 0, 190, 170, DOCK_H);
    prRef.current = prism(gStations, 960, 170, 0, 110, 110, 44);
    prism(gStations, SIDING_X, SIDING_Y, 0, 150, 90, SIDING_H, "siding");

    wallLabel(gLabels, -58, 100, 150, 215, YARD_H, "Yard");
    wallLabel(gLabels, BENCH_X, BENCH_Y, BENCH_W, BENCH_D, BENCH_H, "Build bench");
    wallLabel(gLabels, DOCK_X, DOCK_Y, 190, 170, DOCK_H, "Shipping");
    wallLabel(gLabels, 960, 170, 110, 110, 44, "PR");
    wallLabel(gLabels, SIDING_X, SIDING_Y, 150, 90, SIDING_H, "Review siding");
    label(gLabels, 290, BELT_Y + 34, 6, "Conveyor");
    label(gLabels, BENCH_X + BENCH_W + 16, BELT_Y, BENCH_TOP + 44, "Gate");
    label(gLabels, 300, RETURN_Y + 40, 4, "Retry loop");

    // fit viewBox to a wide static frame (bench→dock→PR span)
    svg.setAttribute("viewBox", "-120 40 1120 470");
  }, []);

  // Create/remove token <g>s when the set of units changes.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const layer = svg.querySelector("#tokens");
    if (!layer) return;
    const map = tokensRef.current;
    const seen = new Set<string>();

    for (const u of units) {
      seen.add(u.unitId);
      if (map.has(u.unitId)) continue;
      const batch = batchForUnit(batches, u.unitId);
      const color = batch?.color ?? "#8A8072";
      const g = el("g", { class: "block", tabindex: "0", role: "button", "aria-label": `${u.scopeGlob} unit` }, layer) as SVGElement;
      (g as SVGElement).style.color = color;
      const w = 22, d = 22, h = 16;
      el("polygon", { class: "f-left", points: pts([P(0, d, h), P(w, d, h), P(w, d, 0), P(0, d, 0)]) }, g);
      el("polygon", { class: "f-right", points: pts([P(w, 0, h), P(w, d, h), P(w, d, 0), P(w, 0, 0)]) }, g);
      el("polygon", { class: "f-top", points: pts([P(0, 0, h), P(w, 0, h), P(w, d, h), P(0, d, h)]) }, g);
      const batchId = batch?.id ?? "";
      const onActivate = () => clickRef.current(batchId);
      g.addEventListener("click", onActivate);
      g.addEventListener("keydown", (e) => {
        const ke = e as KeyboardEvent;
        if (ke.key === "Enter" || ke.key === " ") { ke.preventDefault(); onActivate(); }
      });
      map.set(u.unitId, { g, batchId });
    }
    // remove tokens for units no longer present
    for (const [id, rec] of map) {
      if (!seen.has(id)) {
        rec.g.remove();
        map.delete(id);
      }
    }
  }, [units, batches]);

  // Lay tokens out by status and update badges + gate lamp + PR crate.
  useEffect(() => {
    const map = tokensRef.current;
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // per-zone running index for stacking
    const idx = { yard: 0, bench: 0, dock: 0, siding: 0 };
    const batchOrder = new Map(batches.map((b, i) => [b.id, i]));

    let anyRun = false;
    let anyFail = false;
    let anyRetry = false;
    let allDone = units.length > 0;

    for (const u of units) {
      const rec = map.get(u.unitId);
      if (!rec) continue;
      const vs = visualStatus(u.status);
      let target: [number, number];

      if (vs === "queued") {
        const spot = PILE_SPOTS[(batchOrder.get(rec.batchId) ?? idx.yard) % PILE_SPOTS.length];
        target = P(spot[0], spot[1], YARD_H + (idx.yard % 3) * 10);
        idx.yard++;
        allDone = false;
      } else if (vs === "run" || vs === "retry") {
        const slot = BENCH_SLOTS[idx.bench % BENCH_SLOTS.length];
        target = P(BENCH_X + 45, slot + Math.floor(idx.bench / BENCH_SLOTS.length) * 22, BENCH_TOP);
        idx.bench++;
        allDone = false;
        anyRun = anyRun || vs === "run";
        anyRetry = anyRetry || vs === "retry";
      } else if (vs === "ok") {
        const col = idx.dock % 5, row = Math.floor(idx.dock / 5);
        target = P(DOCK_X + 20 + col * 32, DOCK_Y + 16 + row * 46, DOCK_H);
        idx.dock++;
      } else {
        // fail → siding
        const col = idx.siding % 2, row = Math.floor(idx.siding / 2);
        target = P(SIDING_X + 30 + col * 55, SIDING_Y + 20 + row * 34, SIDING_H);
        idx.siding++;
        anyFail = true;
        allDone = false;
      }

      // badge
      const oldBadge = rec.g.querySelector(".badge");
      if (oldBadge) oldBadge.remove();
      if (vs !== "queued" && vs !== "ok") addBadge(rec.g, vs);
      rec.g.classList.toggle("riding", vs === "retry");

      const tx = target[0], ty = target[1];
      if (reduced) {
        rec.g.setAttribute("transform", `translate(${tx.toFixed(1)} ${ty.toFixed(1)})`);
      } else {
        gsap.to(rec.g, { attr: { transform: `translate(${tx.toFixed(1)} ${ty.toFixed(1)})` }, duration: 0.9, ease: "power2.inOut" });
      }
    }

    // gate lamp reflects the most urgent live state
    const lamp = anyFail ? HEX.fail : anyRetry ? HEX.retry : anyRun ? HEX.run : allDone ? HEX.ok : HEX.queued;
    gateLampRef.current?.setAttribute("fill", lamp);
    // PR crate lit when everything terminal & at least one shipped
    const shipped = units.some((u) => u.status === "passed");
    prRef.current?.setAttribute("class", "prism" + (allDone && shipped ? " lit" : ""));
  }, [units, batches]);

  return (
    <div className="rounded-card border border-foreman-line bg-foreman-card px-4 pb-4 pt-6 shadow-card">
      <style>{SCENE_CSS}</style>
      <svg
        ref={svgRef}
        xmlns={SVGNS}
        className="block h-auto w-full"
        role="img"
        aria-label="Migration yard: queued units, conveyor to the build bench, shipping dock and review siding"
      />
    </div>
  );
}

function addBadge(g: SVGElement, status: "run" | "retry" | "fail") {
  const p = P(11, 0, 30);
  const b = el("g", { class: "badge " + status, transform: `translate(${p[0].toFixed(1)} ${p[1].toFixed(1)})` }, g);
  el("circle", { r: 7, cx: 0, cy: 0, fill: BADGE_FILL[status], stroke: "#FFFEFC", "stroke-width": 1.5 }, b);
  const glyph: Record<string, string> = { fail: "✕", retry: "↻", run: "" };
  if (glyph[status]) {
    const t = el("text", { x: 0, y: 0, class: "badge-glyph" }, b);
    t.textContent = glyph[status];
  }
}

const SCENE_CSS = `
  .prism polygon { stroke: #FFFEFC; stroke-width: 1; }
  .prism { color: #E5DCC9; }
  .f-top { fill: currentColor; }
  .f-right { fill: currentColor; filter: brightness(0.92); }
  .f-left { fill: currentColor; filter: brightness(0.82); }
  .flat { fill: #F1EDE6; stroke: #E0D5C4; stroke-width: 1; }
  .belt.flat { fill: #EDE7DB; stroke: #DBCFBB; }
  .belt-chevron { stroke: #CDBFA6; stroke-width: 1.5; fill: none; }
  @keyframes mf-march { from { transform: translate(0,0); } to { transform: translate(29.44px, 9.86px); } }
  @keyframes mf-marchRev { from { transform: translate(0,0); } to { transform: translate(-29.44px, -9.86px); } }
  .belt-flow { animation: mf-march 1.1s linear infinite; }
  .belt-flow.rev { animation-name: mf-marchRev; }
  .lit .f-top { stroke: var(--foreman-ok, #7C9463); stroke-width: 1.5; }
  .scene-label { font-family: var(--font-inter), sans-serif; font-weight: 600; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; fill: #8A8072; text-anchor: middle; }
  .wall-label { font-family: var(--font-inter), sans-serif; font-weight: 700; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; fill: #4A4136; opacity: 0.9; }
  .prism.siding .f-top { stroke: #D9A99A; stroke-width: 1.5; }
  .block { cursor: pointer; }
  .block polygon { stroke: rgba(255,255,255,0.82); stroke-width: 0.75; }
  .block:focus { outline: none; }
  .block:focus .f-top { stroke: #1C1815; stroke-width: 2; }
  .badge-glyph { fill: #FFFEFC; font-size: 9px; font-weight: 700; text-anchor: middle; dominant-baseline: central; font-family: var(--font-inter), sans-serif; }
  @keyframes mf-badgePulse { 0%,100% { opacity: .35 } 50% { opacity: 1 } }
  .badge.run { animation: mf-badgePulse 1.2s ease-in-out infinite; }
  @keyframes mf-rideBack { from { transform: translate(0,0); } to { transform: translate(-18px, -6px); } }
  .block.riding { animation: mf-rideBack 2.4s ease-in-out infinite alternate; }
  @media (prefers-reduced-motion: reduce) {
    .badge.run, .belt-flow, .block.riding { animation: none; }
  }
`;
