"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { wsUrl } from "@/lib/config";
import type {
  Campaign,
  CampaignWsEvent,
  UnitReasoningEvent,
  UnitStatus,
} from "@/lib/types";

const POLL_INTERVAL_MS = 2000;

export interface ReasoningLine extends UnitReasoningEvent {
  ts: number;
}

interface UseCampaignSocketResult {
  campaign: Campaign | null;
  connected: boolean;
  usingPolling: boolean;
  reasoningLog: ReasoningLine[];
  escalations: Record<string, string>;
  error: string | null;
}

function applyUnitStatus(
  campaign: Campaign,
  unitId: string,
  status: string,
  attempt: number
): Campaign {
  return {
    ...campaign,
    units: campaign.units.map((unit) =>
      unit.unitId === unitId
        ? { ...unit, status: status as UnitStatus, attempt }
        : unit
    ),
  };
}

export function useCampaignSocket(campaignId: string): UseCampaignSocketResult {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [connected, setConnected] = useState(false);
  const [usingPolling, setUsingPolling] = useState(false);
  const [reasoningLog, setReasoningLog] = useState<ReasoningLine[]>([]);
  const [escalations, setEscalations] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const pollHandle = useRef<ReturnType<typeof setInterval> | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;

    const startPolling = () => {
      if (pollHandle.current) return;
      setUsingPolling(true);
      const poll = async () => {
        try {
          const snapshot = await api.getCampaign(campaignId);
          if (!stopped.current) setCampaign(snapshot);
        } catch (err) {
          if (!stopped.current) {
            setError(err instanceof Error ? err.message : "Poll failed");
          }
        }
      };
      poll();
      pollHandle.current = setInterval(poll, POLL_INTERVAL_MS);
    };

    const stopPolling = () => {
      if (pollHandle.current) {
        clearInterval(pollHandle.current);
        pollHandle.current = null;
      }
      setUsingPolling(false);
    };

    // Initial load: GET /campaign/{id} seeds state immediately, independent
    // of whether the WS connects (PROJECT.md section 7: also used for
    // initial load / refresh / resume).
    api
      .getCampaign(campaignId)
      .then((snapshot) => {
        if (!stopped.current) setCampaign(snapshot);
      })
      .catch((err) => {
        if (!stopped.current) {
          setError(err instanceof Error ? err.message : "Failed to load campaign");
        }
      });

    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl(campaignId));
    } catch {
      startPolling();
      return () => {
        stopped.current = true;
        stopPolling();
      };
    }
    socketRef.current = socket;

    socket.onopen = () => {
      if (stopped.current) return;
      setConnected(true);
      stopPolling();
    };

    socket.onmessage = (message) => {
      if (stopped.current) return;
      let parsed: CampaignWsEvent;
      try {
        parsed = JSON.parse(message.data);
      } catch {
        return;
      }

      switch (parsed.event) {
        case "unit_status":
          setCampaign((prev) =>
            prev
              ? applyUnitStatus(
                  prev,
                  parsed.data.unitId,
                  parsed.data.status,
                  parsed.data.attempt
                )
              : prev
          );
          break;
        case "unit_reasoning":
          setReasoningLog((prev) =>
            [...prev, { ...parsed.data, ts: Date.now() }].slice(-500)
          );
          break;
        case "unit_escalated":
          setEscalations((prev) => ({
            ...prev,
            [parsed.data.unitId]: parsed.data.failureLog,
          }));
          break;
        case "campaign_completed":
          setCampaign((prev) => (prev ? { ...prev, status: "completed" } : prev));
          break;
        case "campaign_failed":
          setCampaign((prev) => (prev ? { ...prev, status: "failed" } : prev));
          setError(parsed.data.reason);
          break;
        case "campaign_started":
        default:
          break;
      }
    };

    const handleDrop = () => {
      if (stopped.current) return;
      setConnected(false);
      startPolling();
    };
    socket.onclose = handleDrop;
    socket.onerror = handleDrop;

    return () => {
      stopped.current = true;
      stopPolling();
      socket.close();
    };
  }, [campaignId]);

  return { campaign, connected, usingPolling, reasoningLog, escalations, error };
}
