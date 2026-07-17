"use client";

// The one live-data layer for the whole dashboard shell (frontend_refactor.md
// Phase 3). A single useCampaignSocket connection (WS + 2s polling fallback)
// is opened once here and shared by all six pages via context, so navigating
// Overview -> Plan -> Batches never reconnects. Derived batch state, the
// escalation count (Batches badge), and the accepted fraction (top strip) are
// computed once here. Terminal status is written back to campaignStore so the
// history widget and Summary survive the socket closing (gap G5).

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useCampaignSocket, type ReasoningLine } from "@/hooks/useCampaignSocket";
import { deriveBatches, type Batch } from "@/lib/batches";
import {
  getCampaign as readStoredCampaign,
  markCampaignTerminal,
  type StoredCampaign,
} from "@/lib/campaignStore";
import type { Campaign } from "@/lib/types";

interface CampaignContextValue {
  campaignId: string;
  campaign: Campaign | null;
  stored: StoredCampaign | null;
  batches: Batch[];
  reasoningLog: ReasoningLine[];
  escalations: Record<string, string>;
  blockedUnits: Record<string, { status: string; failureLog: string }>;
  escalationCount: number;
  accepted: number;
  total: number;
  connected: boolean;
  usingPolling: boolean;
  error: string | null;
}

const CampaignContext = createContext<CampaignContextValue | null>(null);

export function CampaignProvider({
  campaignId,
  children,
}: {
  campaignId: string;
  children: React.ReactNode;
}) {
  const {
    campaign,
    connected,
    usingPolling,
    reasoningLog,
    escalations,
    blockedUnits,
    error,
  } = useCampaignSocket(campaignId);

  // Per-browser plan record (title, mode, model, seam). Read after mount to
  // avoid a hydration mismatch on the server-rendered pass.
  const [stored, setStored] = useState<StoredCampaign | null>(null);
  useEffect(() => {
    setStored(readStoredCampaign(campaignId));
  }, [campaignId]);

  const batches = useMemo(
    () => (campaign ? deriveBatches(campaign.units) : []),
    [campaign]
  );

  const units = campaign?.units ?? [];
  const total = units.length;
  const accepted = units.filter((u) => u.status === "passed").length;
  const escalationCount = units.filter((u) => u.status === "escalated").length;

  const status = campaign?.status;
  useEffect(() => {
    if (status !== "completed" && status !== "failed") return;
    const s = readStoredCampaign(campaignId);
    if (s && !s.completedAt) {
      markCampaignTerminal(campaignId, status);
      setStored(readStoredCampaign(campaignId));
    }
  }, [status, campaignId]);

  const value: CampaignContextValue = {
    campaignId,
    campaign,
    stored,
    batches,
    reasoningLog,
    escalations,
    blockedUnits,
    escalationCount,
    accepted,
    total,
    connected,
    usingPolling,
    error,
  };

  return <CampaignContext.Provider value={value}>{children}</CampaignContext.Provider>;
}

export function useCampaign(): CampaignContextValue {
  const ctx = useContext(CampaignContext);
  if (!ctx) throw new Error("useCampaign must be used within a CampaignProvider");
  return ctx;
}
