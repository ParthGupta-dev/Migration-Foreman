"use client";

import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { UnitPreview } from "@/lib/types";
import { renderMarkdown } from "@/utils/renderMarkdown";

interface UnitPreviewPanelProps {
  campaignId: string;
  unitId: string;
}

const MARKDOWN_STYLE = `
  body { font-family: ui-sans-serif, system-ui, sans-serif; color: #1e293b;
         background: #ffffff; padding: 16px 20px; line-height: 1.6; margin: 0; }
  h1, h2, h3 { border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; font-size: 0.9em; }
  pre { background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; color: inherit; }
  a { color: #2563eb; }
`;

// Generic sample document that changed CSS gets applied to, Storybook-style.
const CSS_HARNESS = `
  <h1>Heading</h1>
  <p>Paragraph text with a <a href="#">link</a> and <code>inline code</code>.</p>
  <div class="card"><h2>Card title</h2><p>Card body content.</p></div>
  <button>Primary action</button>
  <ul><li>List item one</li><li>List item two</li></ul>
`;

function docFor(preview: UnitPreview, content: string): string {
  if (preview.fileType === "markdown") {
    return `<!doctype html><html><head><style>${MARKDOWN_STYLE}</style></head><body>${renderMarkdown(content)}</body></html>`;
  }
  if (preview.fileType === "css") {
    return `<!doctype html><html><head><style>body{font-family:sans-serif;padding:16px}</style><style>${content}</style></head><body>${CSS_HARNESS}</body></html>`;
  }
  return content; // html — rendered as-is inside the sandboxed iframe
}

function PreviewPane({ preview, content, label }: { preview: UnitPreview; content: string | null; label: string }) {
  return (
    <div className="flex-1 min-w-0 space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      {content === null ? (
        <p className="rounded border border-slate-800 bg-slate-950 p-3 text-xs text-slate-500">
          {label === "After"
            ? "Not merged into the campaign branch (unit escalated) — no after version."
            : "File does not exist on this branch."}
        </p>
      ) : preview.fileType === "code" ? (
        <pre className="max-h-72 overflow-auto rounded border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
          {content}
        </pre>
      ) : (
        <iframe
          title={`${label} preview of ${preview.path}`}
          sandbox=""
          srcDoc={docFor(preview, content)}
          className="h-72 w-full rounded border border-slate-800 bg-white"
        />
      )}
    </div>
  );
}

export default function UnitPreviewPanel({ campaignId, unitId }: UnitPreviewPanelProps) {
  const [preview, setPreview] = useState<UnitPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTests, setShowTests] = useState(false);

  useEffect(() => {
    setPreview(null);
    setError(null);
    api
      .getUnitPreview(campaignId, unitId)
      .then(setPreview)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [campaignId, unitId]);

  if (error) return <p className="text-sm text-red-400">Preview failed: {error}</p>;
  if (!preview) return <p className="text-sm text-slate-500 animate-pulse">Loading preview…</p>;

  return (
    <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-slate-300">{preview.path}</span>
        <span className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-400">
          {preview.fileType === "code" ? preview.language ?? "code" : preview.fileType}
        </span>
      </div>

      <div className="flex flex-col gap-3 md:flex-row">
        <PreviewPane preview={preview} content={preview.before} label="Before" />
        <PreviewPane preview={preview} content={preview.after} label="After" />
      </div>

      {preview.testLog && (
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setShowTests((visible) => !visible)}
            className="text-xs text-blue-400 underline decoration-dotted hover:text-blue-300"
          >
            {showTests ? "Hide test output" : "Show test output"}
          </button>
          {showTests && (
            <pre className="max-h-56 overflow-auto rounded border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
              {preview.testLog}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
