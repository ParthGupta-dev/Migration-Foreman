"use client";

import { useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  type Edge,
  type Node,
} from "reactflow";
import "reactflow/dist/style.css";
import type { GraphEdge, GraphNode } from "@/lib/types";

const COLUMN_WIDTH = 220;
const ROW_HEIGHT = 90;

interface DependencyGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** nodeId -> hex color override (e.g. blast-radius highlight or live unit status) */
  colorForNode?: (nodeId: string) => string | undefined;
  height?: number;
}

function shortLabel(id: string): string {
  const parts = id.split("/");
  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : id;
}

export default function DependencyGraph({
  nodes,
  edges,
  colorForNode,
  height = 420,
}: DependencyGraphProps) {
  const flowNodes: Node[] = useMemo(() => {
    const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
    return nodes.map((node, index) => {
      const color = colorForNode?.(node.id);
      return {
        id: node.id,
        position: {
          x: (index % columns) * COLUMN_WIDTH,
          y: Math.floor(index / columns) * ROW_HEIGHT,
        },
        data: { label: shortLabel(node.id) },
        style: {
          background: color ?? "#1e293b",
          color: "#f1f5f9",
          border: color ? "2px solid #f8fafc" : "1px solid #334155",
          borderRadius: 8,
          fontSize: 11,
          padding: 8,
          width: 190,
        },
      };
    });
  }, [nodes, colorForNode]);

  const flowEdges: Edge[] = useMemo(
    () =>
      edges.map((edge, index) => ({
        id: `${edge.source}->${edge.target}-${index}`,
        source: edge.source,
        target: edge.target,
        style: { stroke: "#475569" },
      })),
    [edges]
  );

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-slate-500 border border-dashed border-slate-700 rounded-lg">
        No graph data available — falling back to the unit status table.
      </div>
    );
  }

  return (
    <div style={{ height }} className="rounded-lg border border-slate-800 overflow-hidden">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1e293b" gap={16} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
