"use client";

// Chat page (frontend_refactor.md Phase 7, mock: design/mocks/chat.html). The
// planning session, continued in the shell: the landing-page excerpt (from the
// per-browser plan record) with a plan mini-card, then the real conversational
// thread. The Phase 9 backend is live, so the composer is enabled for real:
// POST /campaign/{id}/chat persists both turns, and when the discussion is
// scoped to a retryable unit a Retry action re-runs verification via
// POST /campaign/{id}/chat/retry-unit/{unitId}. `?ref=B-xx` arrives from an
// escalated batch's "Discuss in chat" link and prefills the failure prompt.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCampaign } from "@/lib/campaignContext";
import { api, ApiError } from "@/lib/api";
import { isBlockedStatus } from "@/lib/batches";
import type { Batch } from "@/lib/batches";
import { clockTime } from "@/lib/format";
import type { ChatMessageRecord, Unit } from "@/lib/types";

interface ActiveRef {
  batchId: string;
  label: string;
  unitId: string;
}

function isRetryable(status: Unit["status"] | undefined): boolean {
  return (
    status === "escalated" ||
    status === "failed" ||
    (status !== undefined && isBlockedStatus(status))
  );
}

export default function ChatPage() {
  const { campaignId, campaign, stored, batches } = useCampaign();

  const [history, setHistory] = useState<ChatMessageRecord[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRef, setActiveRef] = useState<ActiveRef | null>(null);
  const [refApplied, setRefApplied] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Load persisted chat history.
  useEffect(() => {
    let alive = true;
    api
      .getChat(campaignId)
      .then((r) => alive && setHistory(r.messages))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [campaignId]);

  // ?ref=B-xx → resolve to the batch's escalated (retryable) unit and prefill
  // the failure prompt with an amber ring + reference chip.
  useEffect(() => {
    if (refApplied || batches.length === 0) return;
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (!ref) {
      setRefApplied(true);
      return;
    }
    const batch = batches.find((b) => b.id === ref);
    const unit = batch ? pickReferableUnit(batch) : undefined;
    if (batch && unit) {
      setActiveRef({ batchId: batch.id, label: batch.label, unitId: unit.unitId });
      setInput(
        `Batch ${batch.label} (${batch.id}) failed verification — explain why it failed and propose a fix.`
      );
    }
    setRefApplied(true);
  }, [batches, refApplied]);

  // Auto-scroll to the newest message.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history.length, sending]);

  // The unit a Retry action would target: the active ?ref unit, else the most
  // recent message that carries a unitRef.
  const retryTarget = useMemo(() => {
    const unitId = activeRef?.unitId ?? [...history].reverse().find((m) => m.unitRef)?.unitRef ?? null;
    if (!unitId) return null;
    const unit = campaign?.units.find((u) => u.unitId === unitId);
    return unit && isRetryable(unit.status) ? unit : null;
  }, [activeRef, history, campaign]);

  async function send() {
    const message = input.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    // Optimistically show the user's message.
    const optimistic: ChatMessageRecord = {
      messageId: `local-${Date.now()}`,
      role: "user",
      content: message,
      unitRef: activeRef?.unitId ?? null,
      action: null,
      createdAt: new Date().toISOString(),
    };
    setHistory((h) => [...h, optimistic]);
    setInput("");
    try {
      const res = await api.postChat(campaignId, message, activeRef?.unitId);
      // Replace optimistic with the persisted pair.
      setHistory((h) => [...h.filter((m) => m.messageId !== optimistic.messageId), res.userMessage, res.assistantMessage]);
    } catch (e) {
      setHistory((h) => h.filter((m) => m.messageId !== optimistic.messageId));
      setInput(message);
      setError(e instanceof ApiError ? e.message : "Message failed to send.");
    } finally {
      setSending(false);
    }
  }

  async function retry() {
    if (!retryTarget || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await api.retryUnit(campaignId, retryTarget.unitId);
      setHistory((h) => [...h, res.systemMessage]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Retry failed.");
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const excerpt = stored?.chatExcerpt ?? [];

  return (
    <div className="flex h-[calc(100vh-71px)] flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
        <div className="mx-auto flex max-w-[780px] flex-col gap-[18px]">
          {/* planning excerpt from the landing session */}
          {excerpt.length > 0 && (
            <>
              <Divider>planning · landing page · {clockTime(stored?.plannedAt)}</Divider>
              {excerpt.map((m, i) => (
                <Bubble key={`ex-${i}`} role={m.role === "user" ? "user" : "assistant"} content={m.text} />
              ))}
              {stored && (
                <div className="ml-[38px]">
                  <PlanMini
                    campaignId={campaignId}
                    seamName={stored.title}
                    scope={stored.seam.scopeGlobs.join(" · ")}
                    batches={batches}
                    testCommand={stored.seam.testCommand}
                  />
                </div>
              )}
              <Divider>campaign started · {clockTime(stored?.startedAt)}</Divider>
            </>
          )}

          {history.length === 0 && excerpt.length === 0 && (
            <p className="py-8 text-center text-[13px] text-foreman-dim">
              Ask what&rsquo;s going on, or open an escalated batch and pick &ldquo;Discuss in
              chat&rdquo;. The foreman sees live unit status, failure logs and diffs.
            </p>
          )}

          {history.map((m) =>
            m.role === "system" ? (
              <SystemLine key={m.messageId} content={m.content} />
            ) : (
              <Bubble key={m.messageId} role={m.role} content={m.content} />
            )
          )}

          {sending && <Bubble role="assistant" content="" typing />}
        </div>
      </div>

      <div className="border-t border-foreman-line bg-foreman-card px-8 pb-5 pt-4">
        {activeRef && (
          <p className="mx-auto mb-2 max-w-[780px] text-xs text-foreman-retry-text">
            ↳ referencing batch <strong>{activeRef.label} · {activeRef.batchId}</strong> from the
            Batches page
          </p>
        )}
        <div
          className={`mx-auto flex max-w-[780px] items-end gap-2.5 rounded-[14px] border bg-foreman-card p-2.5 pl-4 ${
            activeRef ? "border-foreman-retry ring-[3px] ring-foreman-retry-bg" : "border-[#D6C9B5]"
          }`}
        >
          <textarea
            ref={taRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask what's going on, or discuss a failed batch…"
            aria-label="Message Foreman"
            className="max-h-[130px] flex-1 resize-none bg-transparent py-1 text-sm leading-normal focus:outline-none"
          />
          {retryTarget && (
            <button
              type="button"
              onClick={retry}
              disabled={sending}
              title={`Re-run verification for ${retryTarget.scopeGlob}`}
              className="flex-none whitespace-nowrap rounded-[10px] border border-foreman-retry bg-foreman-retry-bg px-3 py-2 text-[13px] font-semibold text-foreman-retry-text hover:brightness-95 disabled:opacity-60"
            >
              ↻ Retry {retryTarget.scopeGlob.split("/").slice(-1)[0]}
            </button>
          )}
          <button
            type="button"
            onClick={send}
            disabled={sending || !input.trim()}
            aria-label="Send"
            className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] bg-foreman-primary text-white hover:bg-[#5A4A3A] disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12 7-7 7 7" />
              <path d="M12 19V5" />
            </svg>
          </button>
        </div>
        <p className="mx-auto mt-2 max-w-[780px] font-mono text-[11px] text-foreman-faint">
          {retryTarget
            ? `foreman can re-dispatch ${retryTarget.scopeGlob.split("/").slice(-1)[0]} for real · it sees live unit status, failure logs and diffs`
            : "foreman sees live unit status, failure logs and diffs"}
        </p>
        {error && <p className="mx-auto mt-2 max-w-[780px] text-xs text-foreman-fail-text">{error}</p>}
      </div>
    </div>
  );
}

function pickReferableUnit(batch: Batch): Unit | undefined {
  return (
    batch.units.find((u) => u.status === "escalated") ??
    batch.units.find((u) => isRetryable(u.status)) ??
    batch.units[0]
  );
}

function Divider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[11px] text-foreman-faint">
      <span className="h-px flex-1 bg-foreman-line" />
      {children}
      <span className="h-px flex-1 bg-foreman-line" />
    </div>
  );
}

function Bubble({ role, content, typing }: { role: "user" | "assistant"; content: string; typing?: boolean }) {
  const isUser = role === "user";
  return (
    <div className={`flex max-w-[86%] gap-3 ${isUser ? "flex-row-reverse self-end" : ""}`}>
      {!isUser && (
        <span
          aria-hidden
          className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg bg-foreman-accent text-[11px] font-bold text-white"
        >
          F
        </span>
      )}
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className={`text-[11px] font-semibold uppercase tracking-[0.04em] text-foreman-faint ${isUser ? "text-right" : ""}`}>
          {isUser ? "You" : "Foreman"}
        </span>
        <div
          className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? "rounded-tr-[4px] bg-foreman-primary text-[#FDFBF8]"
              : "rounded-tl-[4px] border border-foreman-line bg-foreman-card shadow-card"
          }`}
        >
          {typing ? (
            <span className="inline-flex gap-1 py-1">
              <Dot /> <Dot /> <Dot />
            </span>
          ) : (
            content
          )}
        </div>
      </div>
    </div>
  );
}

function SystemLine({ content }: { content: string }) {
  return (
    <div className="flex items-center gap-3 text-[12px] text-foreman-dim">
      <span className="h-px flex-1 bg-foreman-line" />
      <span className="font-mono">{content}</span>
      <span className="h-px flex-1 bg-foreman-line" />
    </div>
  );
}

function Dot() {
  return <i className="h-1.5 w-1.5 rounded-full bg-foreman-faint" />;
}

function PlanMini({
  campaignId,
  seamName,
  scope,
  batches,
  testCommand,
}: {
  campaignId: string;
  seamName: string;
  scope: string;
  batches: Batch[];
  testCommand: string;
}) {
  return (
    <div className="mt-2.5 rounded-ctl border border-foreman-line bg-foreman-bg p-3.5 text-[12.5px]">
      <dl className="grid grid-cols-[110px_1fr] gap-y-1.5">
        <dt className="text-foreman-dim">Seam</dt>
        <dd className="font-mono">{seamName}</dd>
        <dt className="text-foreman-dim">Scope</dt>
        <dd className="font-mono">{scope}</dd>
        <dt className="text-foreman-dim">Batches</dt>
        <dd className="font-mono">{batches.map((b) => b.label).join(" · ") || "—"}</dd>
        <dt className="text-foreman-dim">Gate</dt>
        <dd className="font-mono">{testCommand}</dd>
      </dl>
      <Link href={`/campaign/${campaignId}/plan`} className="mt-2 inline-block text-xs">
        view the full plan →
      </Link>
    </div>
  );
}
