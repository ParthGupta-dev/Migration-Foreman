"use client";

import { ArrowUp } from "lucide-react";
import ModeMenu, { MODES, type ComposerMode } from "./ModeMenu";
import ModelMenu from "./ModelMenu";
import type { LlmProvider } from "@/lib/types";

const PLACEHOLDERS: Record<ComposerMode, string> = {
  scan: "Ask Foreman to scan for candidates, or just hit send.",
  autonomous: "Ask Foreman to find the best migration itself, or just hit send.",
  describe: "Describe the migration — e.g. Migrate legacy_format to format_text, keeping keyword arguments intact.",
};

export default function Composer({
  mode,
  onModeChange,
  intent,
  onIntentChange,
  disabled,
  submitting,
  providers,
  selectedModel,
  onSelectModel,
  onSubmit,
}: {
  mode: ComposerMode;
  onModeChange: (mode: ComposerMode) => void;
  intent: string;
  onIntentChange: (value: string) => void;
  disabled: boolean;
  submitting: boolean;
  providers: LlmProvider[];
  selectedModel: string | null;
  onSelectModel: (model: string) => void;
  onSubmit: () => void;
}) {
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && !submitting) onSubmit();
    }
  }

  return (
    <div
      className={`rounded-2xl border border-foreman-line px-4 pb-3 pt-4 shadow-card ${
        disabled ? "bg-[#F5F0E8]" : "bg-foreman-card"
      }`}
      style={{ boxShadow: "0 1px 2px rgba(16,24,40,0.05), 0 8px 24px rgba(16,24,40,0.06)" }}
    >
      <textarea
        rows={2}
        disabled={disabled}
        value={intent}
        onChange={(e) => onIntentChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? "Select a codebase to begin" : PLACEHOLDERS[mode]}
        className="w-full resize-none border-none bg-transparent px-1 pb-3 pt-1 text-[15px] leading-relaxed text-foreman-ink placeholder:text-foreman-faint focus:outline-none"
      />
      <div className="flex items-center gap-2 border-t border-foreman-line pt-2.5">
        <ModeMenu mode={mode} onChange={onModeChange} />
        <ModelMenu providers={providers} selected={selectedModel} onChange={onSelectModel} />
        <button
          type="button"
          disabled={disabled || submitting}
          onClick={onSubmit}
          aria-label="Submit"
          className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full bg-foreman-primary text-white hover:bg-[#5A4A3A] disabled:bg-foreman-queued-bg disabled:text-foreman-faint"
        >
          <ArrowUp size={15} />
        </button>
      </div>
    </div>
  );
}

export function defaultIntentFor(mode: ComposerMode): string {
  if (mode === "scan") return "Scan for the highest-leverage migration candidates.";
  if (mode === "autonomous") return "Find and propose the best migration autonomously.";
  return MODES.describe.hint;
}
