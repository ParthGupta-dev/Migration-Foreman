"use client";

// Blast-radius dependency graph (mock: plan.html `.graph-svg` + legend).
// Renders GET /repo/{repoId}/graph with reactflow, recoloured to the foreman
// tokens: in-scope files get the run-ink border, server-blacklisted files the
// fail border (dashed), everything else stays faint/unaffected. A simple
// column-per-top-level-directory layout keeps it dependency-readable without
// pulling in a layout engine (no new dependency — CLAUDE.md).

import { useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  type Edge,
  type Node,
} from "reactflow";
import "reactflow/dist/style.css";
import { api, ApiError } from "@/lib/api";
import type { GraphResponse } from "@/lib/types";

// Mirrors the server-side safety blacklist (discovery/blacklist) closely
// enough to colour the graph; the real gate is enforced server-side.
const BLACKLIST_PREFIXES = ["payments/", "auth/", "billing/"];
const BLACKLIST_CONTAINS = ["/migrations/", "migrations/"];

function isBlacklisted(path: string): boolean {
  return (
    BLACKLIST_PREFIXES.some((p) => path.startsWith(p)) ||
    BLACKLIST_CONTAINS.some((c) => path.includes(c))
  );
}

function topDir(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts[0] : ".";
}

export default function BlastGraph({
  repoId,
  scopeGlobs,
}: {
  repoId: string;
  scopeGlobs: string[];
}) {
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getGraph(repoId)
      .then((g) => alive && setGraph(g))
      .catch((e) =>
        alive && setError(e instanceof ApiError ? e.message : "Graph unavailable.")
      );
    return () => {
      alive = false;
    };
  }, [repoId]);

  const inScope = useMemo(() => new Set(scopeGlobs), [scopeGlobs]);

  const { nodes, edges, counts } = useMemo(() => {
    if (!graph) return { nodes: [] as Node[], edges: [] as Edge[], counts: { scope: 0, black: 0, un: 0 } };

    // Column per top-level directory, sorted; stack files within a column.
    const cols = [...new Set(graph.nodes.map((n) => topDir(n.id)))].sort((a, b) =>
      a.localeCompare(b)
    );
    const rowByCol: Record<string, number> = {};
    let scope = 0;
    let black = 0;
    let un = 0;

    const nodes: Node[] = graph.nodes.map((n) => {
      const col = cols.indexOf(topDir(n.id));
      const row = (rowByCol[topDir(n.id)] = (rowByCol[topDir(n.id)] ?? -1) + 1);
      const scoped = inScope.has(n.id);
      const black_ = isBlacklisted(n.id);
      if (scoped) scope++;
      else if (black_) black++;
      else un++;

      const border = scoped ? "#3D362D" : black_ ? "#B15D48" : "#D6C9B5";
      const textColor = scoped ? "#1C1815" : "#8A8072";
      const label = n.id.split("/").slice(-1)[0];

      return {
        id: n.id,
        position: { x: col * 190, y: row * 64 },
        data: { label },
        draggable: false,
        connectable: false,
        selectable: false,
        style: {
          fontFamily: "var(--font-plex-mono), monospace",
          fontSize: 11,
          color: textColor,
          background: "#FFFEFC",
          border: `1.5px ${black_ ? "dashed" : "solid"} ${border}`,
          borderRadius: 6,
          padding: "6px 10px",
          width: 150,
          textAlign: "center" as const,
        },
      };
    });

    const edges: Edge[] = graph.edges.map((e, i) => ({
      id: `e-${i}`,
      source: e.source,
      target: e.target,
      style: { stroke: "#D6C9B5", strokeWidth: 1 },
    }));

    return { nodes, edges, counts: { scope, black, un } };
  }, [graph, inScope]);

  if (error) {
    return <p className="font-mono text-xs text-foreman-dim">{error}</p>;
  }
  if (!graph) {
    return <p className="font-mono text-xs text-foreman-dim">Loading dependency graph…</p>;
  }

  return (
    <div>
      <div className="h-[320px] w-full overflow-hidden rounded-ctl border border-foreman-line bg-foreman-bg">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag
          zoomOnScroll={false}
        >
          <Background color="#E8E0D3" gap={20} />
        </ReactFlow>
      </div>
      <div className="mt-4 flex flex-wrap gap-6 text-xs text-foreman-dim">
        <span className="inline-flex items-center gap-2">
          <i className="h-3 w-3 rounded border-[1.5px] border-foreman-run bg-foreman-card" />
          In scope ({counts.scope})
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="h-3 w-3 rounded border-[1.5px] border-dashed border-foreman-fail bg-foreman-card" />
          Blacklisted ({counts.black})
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="h-3 w-3 rounded border-[1.5px] border-[#D6C9B5] bg-foreman-card" />
          Unaffected ({counts.un})
        </span>
      </div>
    </div>
  );
}
