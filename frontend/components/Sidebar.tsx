"use client";

// Collapsible dashboard sidebar (frontend_refactor.md Phase 3, mock:
// design/mocks/*.html shared shell). Ported 1:1 from foreman.css's `.sidebar`
// rules — Lucide icons, active nav via pathname, a red escalation badge on
// Batches, and the campaign history list (live campaign pinned, past ones
// switch the whole dashboard). Collapse state is owned by the layout and
// persisted to localStorage there.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Boxes,
  ClipboardCheck,
  Factory,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ScrollText,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { useCampaign } from "@/lib/campaignContext";
import { listCampaigns, type StoredCampaign } from "@/lib/campaignStore";

interface NavEntry {
  seg: string;
  label: string;
  Icon: LucideIcon;
  badge?: boolean;
}

const NAV: NavEntry[] = [
  { seg: "overview", label: "Overview", Icon: Factory },
  { seg: "plan", label: "Plan", Icon: ScrollText },
  { seg: "batches", label: "Batches", Icon: Boxes, badge: true },
  { seg: "chat", label: "Chat", Icon: MessageSquare },
  { seg: "log", label: "Log", Icon: Terminal },
  { seg: "summary", label: "Summary", Icon: ClipboardCheck },
];

export default function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const { campaignId, escalationCount, campaign, accepted, total } = useCampaign();
  const activeSeg = pathname?.split("/").pop();

  const [history, setHistory] = useState<StoredCampaign[]>([]);
  useEffect(() => {
    setHistory(listCampaigns());
  }, [campaignId]);

  return (
    <aside className="sticky top-0 flex h-screen flex-col overflow-hidden border-r border-foreman-line bg-foreman-card px-3 pb-4 pt-5">
      <div className={`flex items-center gap-2.5 px-3 pb-5 pt-1 ${collapsed ? "justify-center px-0" : ""}`}>
        <span className="h-2.5 w-2.5 flex-none rounded-[3px] bg-foreman-accent" />
        {!collapsed && <span className="text-sm font-bold tracking-[0.02em]">Foreman</span>}
      </div>

      <nav className="flex flex-col gap-0.5" aria-label="Main">
        {NAV.map(({ seg, label, Icon, badge }) => {
          const active = activeSeg === seg;
          const showBadge = badge && escalationCount > 0;
          return (
            <Link
              key={seg}
              href={`/campaign/${campaignId}/${seg}`}
              aria-current={active ? "page" : undefined}
              title={label}
              className={`relative flex items-center gap-2.5 rounded-ctl px-3 py-2 text-sm font-medium no-underline hover:bg-foreman-bg hover:text-foreman-ink ${
                active ? "bg-foreman-queued-bg font-semibold text-foreman-ink" : "text-foreman-dim"
              } ${collapsed ? "justify-center px-0 py-2.5" : ""}`}
            >
              <Icon size={16} strokeWidth={2} className="flex-none" />
              {!collapsed && <span className="whitespace-nowrap">{label}</span>}
              {showBadge && !collapsed && (
                <span className="ml-auto rounded-full bg-foreman-fail-bg px-2 text-xs font-semibold leading-5 tabular-nums text-foreman-fail-text">
                  {escalationCount}
                </span>
              )}
              {showBadge && collapsed && (
                <span className="absolute right-2.5 top-1.5 h-1.5 w-1.5 rounded-full bg-foreman-fail" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mx-1 my-4 border-t border-foreman-line" />

      {!collapsed && (
        <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreman-faint">
          Campaigns
        </div>
      )}

      <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
        {history.map((c) => {
          const isActive = c.campaignId === campaignId;
          const { lampClass, meta } = historyDisplay(c, isActive, campaign?.status, accepted, total);
          return (
            <Link
              key={c.campaignId}
              href={`/campaign/${c.campaignId}/overview`}
              title={c.title}
              className={`flex items-center gap-2.5 rounded-ctl px-3 py-[7px] text-foreman-ink no-underline hover:bg-foreman-bg ${
                isActive ? "bg-foreman-queued-bg" : ""
              } ${collapsed ? "justify-center px-0" : ""}`}
            >
              <span className={`h-2 w-2 flex-none rounded-full ${lampClass}`} />
              {!collapsed && (
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] font-medium">{c.title}</span>
                  <span className="font-mono text-[11px] tabular-nums text-foreman-dim">{meta}</span>
                </span>
              )}
            </Link>
          );
        })}

        <Link
          href="/"
          title="New campaign"
          className={`mt-0.5 flex items-center gap-2.5 rounded-ctl px-3 py-[7px] text-[13px] font-medium text-foreman-dim no-underline hover:bg-foreman-bg hover:text-foreman-ink ${
            collapsed ? "justify-center px-0" : ""
          }`}
        >
          <Plus size={16} strokeWidth={2} className="flex-none" />
          {!collapsed && <span className="whitespace-nowrap">New campaign</span>}
        </Link>
      </div>

      <button
        type="button"
        onClick={onToggle}
        title="Toggle sidebar"
        aria-label="Toggle sidebar"
        className={`mt-auto flex items-center gap-2.5 rounded-ctl px-3 py-2 text-[13px] font-medium text-foreman-faint hover:bg-foreman-bg hover:text-foreman-ink ${
          collapsed ? "justify-center px-0" : ""
        }`}
      >
        {collapsed ? (
          <PanelLeftOpen size={16} strokeWidth={2} className="flex-none" />
        ) : (
          <>
            <PanelLeftClose size={16} strokeWidth={2} className="flex-none" />
            <span className="whitespace-nowrap">Collapse</span>
          </>
        )}
      </button>
    </aside>
  );
}

function historyDisplay(
  c: StoredCampaign,
  isActive: boolean,
  liveStatus: string | undefined,
  accepted: number,
  total: number
): { lampClass: string; meta: string } {
  // The active campaign reads live status + fraction from the socket; past
  // campaigns fall back to the stored terminal outcome + age (their live unit
  // counts aren't fetched — a known per-browser limitation, gaps G3/G5).
  if (isActive) {
    if (liveStatus === "completed") return { lampClass: "bg-foreman-ok", meta: `done · ${accepted}/${total}` };
    if (liveStatus === "failed") return { lampClass: "bg-foreman-fail", meta: "failed" };
    return { lampClass: "bg-foreman-run pulse", meta: total ? `running · ${accepted}/${total}` : "running" };
  }
  const age = timeAgo(c.completedAt ?? c.startedAt);
  if (c.outcome === "completed") return { lampClass: "bg-foreman-ok", meta: `done · ${age}` };
  if (c.outcome === "failed") return { lampClass: "bg-foreman-fail", meta: `failed · ${age}` };
  return { lampClass: "bg-foreman-run pulse", meta: `running · ${age}` };
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
