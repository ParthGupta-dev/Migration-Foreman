"use client";

// Live Preview + full test log for one file (mock: batches.html — the per-file
// "Live Preview / full test log"; frontend_refactor.md Phase 4 item 4). Fetches
// GET /campaign/{id}/unit/{id}/preview on demand and renders it per fileType:
// markdown rendered, html in a fully-sandboxed iframe, css/code as before/after
// pairs, plus the full test log. Kept lazy so the board stays cheap — nothing
// is fetched until the user opens the preview.

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { renderMarkdown } from "@/utils/renderMarkdown";
import type { UnitPreview } from "@/lib/types";
import { LogBlock, PlainBlock } from "./CodeBlock";

export default function LivePreview({
  campaignId,
  unitId,
}: {
  campaignId: string;
  unitId: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<UnitPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (preview || loading) return;
    setLoading(true);
    setError(null);
    try {
      setPreview(await api.getUnitPreview(campaignId, unitId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Preview unavailable for this file yet.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3.5">
      <button
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-2 rounded-ctl border border-[#D6C9B5] bg-foreman-card px-3 py-[5px] text-[13px] font-semibold text-foreman-ink hover:bg-foreman-bg"
      >
        {open ? "Hide preview" : "Live preview & test log"}
      </button>

      {open && (
        <div className="mt-3">
          {loading && <p className="text-xs text-foreman-dim">Loading preview…</p>}
          {error && <p className="text-xs text-foreman-fail-text">{error}</p>}
          {preview && !loading && <PreviewBody preview={preview} />}
        </div>
      )}
    </div>
  );
}

function PreviewBody({ preview }: { preview: UnitPreview }) {
  const rendered = preview.after ?? preview.before;

  return (
    <div className="flex flex-col gap-4">
      <Rendered preview={preview} content={rendered} />
      {preview.testLog && (
        <div>
          <SubHead>Full test log</SubHead>
          <LogBlock text={preview.testLog} tone="plain" />
        </div>
      )}
    </div>
  );
}

function Rendered({ preview, content }: { preview: UnitPreview; content: string | null }) {
  if (content == null) {
    return (
      <p className="font-mono text-xs text-foreman-dim">
        preview available once the file is accepted and merged
      </p>
    );
  }

  if (preview.fileType === "markdown") {
    return (
      <div>
        <SubHead>Rendered ({preview.path})</SubHead>
        <div
          className="markdown-preview rounded-ctl border border-foreman-line bg-foreman-card p-4 text-[13px] leading-relaxed text-foreman-ink"
          // renderMarkdown HTML-escapes its input before any transformation, so
          // this can never inject raw HTML/scripts (see utils/renderMarkdown.ts).
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
        />
      </div>
    );
  }

  if (preview.fileType === "html") {
    return (
      <div>
        <SubHead>Rendered ({preview.path})</SubHead>
        <iframe
          title={`preview-${preview.unitId}`}
          // Empty sandbox = no scripts, no same-origin, no forms — the preview
          // is inert display only.
          sandbox=""
          srcDoc={content}
          className="h-72 w-full rounded-ctl border border-foreman-line bg-white"
        />
      </div>
    );
  }

  // css / code: before → after pair (before omitted when it's a new file).
  return (
    <div className="flex flex-col gap-3">
      {preview.before != null && (
        <div>
          <SubHead>Before ({preview.path})</SubHead>
          <PlainBlock text={preview.before} />
        </div>
      )}
      <div>
        <SubHead>{preview.before != null ? "After" : preview.path}</SubHead>
        <PlainBlock text={content} />
      </div>
    </div>
  );
}

function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-foreman-dim">
      {children}
    </h4>
  );
}
