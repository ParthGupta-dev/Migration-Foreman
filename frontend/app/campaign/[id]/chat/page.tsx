"use client";

import { useCampaign } from "@/lib/campaignContext";
import PageScaffold, { PhaseNote } from "@/components/PageScaffold";

export default function ChatPage() {
  const { stored } = useCampaign();
  const turns = stored?.chatExcerpt.length ?? 0;

  return (
    <PageScaffold title="Chat" sub="The planning session, continued in the shell.">
      <PhaseNote>
        <p className="mb-2 text-foreman-ink">
          Chat UI ships in Phase 7 (mock: <span className="font-mono">chat.html</span>); the live
          conversational endpoint is Phase-9 gated (new backend contract).
        </p>
        <p>
          <span className="font-mono tabular-nums text-foreman-ink">{turns}</span> planning{" "}
          {turns === 1 ? "turn" : "turns"} carried over from the landing session.
        </p>
      </PhaseNote>
    </PageScaffold>
  );
}
