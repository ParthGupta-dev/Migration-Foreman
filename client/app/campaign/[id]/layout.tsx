"use client";

// The dashboard shell (frontend_refactor.md Phase 3). Two-column grid
// (sidebar + content) wrapping every /campaign/[id]/* page; `/` (landing)
// keeps the bare root layout with no shell. One CampaignProvider here means a
// single shared socket for all six pages. Collapse state lives here (owner of
// the grid width) and persists to localStorage under the mock's key.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CampaignProvider } from "@/lib/campaignContext";
import Sidebar from "@/components/Sidebar";
import TopStrip from "@/components/TopStrip";

const SB_KEY = "mf-sb-min";

export default function CampaignLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const [collapsed, setCollapsed] = useState(false);

  // Read persisted state after mount so SSR and first client render agree
  // (expanded), then snap to the stored preference.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SB_KEY) === "1");
    } catch {
      /* localStorage unavailable — stay expanded */
    }
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SB_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <CampaignProvider campaignId={params.id}>
      <div
        className="grid min-h-screen transition-[grid-template-columns] duration-200"
        style={{ gridTemplateColumns: collapsed ? "64px 1fr" : "232px 1fr" }}
      >
        <Sidebar collapsed={collapsed} onToggle={toggle} />
        <main className="min-w-0">
          <TopStrip />
          {children}
        </main>
      </div>
    </CampaignProvider>
  );
}
