// Diff / log / code surfaces (mock: foreman.css `.codeblock`). One soft-parchment
// block, mono, horizontally scrollable, with GitHub-style add/del tinting for
// diffs and fail-text lines for failure logs.

type LineKind = "hunk" | "add" | "del" | "ctx";

function classifyDiffLine(line: string): LineKind {
  if (line.startsWith("@@")) return "hunk";
  // File headers render like hunk headers (faint) rather than as add/del.
  if (
    line.startsWith("+++") ||
    line.startsWith("---") ||
    line.startsWith("diff ") ||
    line.startsWith("index ") ||
    line.startsWith("new file") ||
    line.startsWith("deleted file") ||
    line.startsWith("rename ")
  ) {
    return "hunk";
  }
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
}

const KIND_CLASS: Record<LineKind, string> = {
  hunk: "text-foreman-faint",
  add: "text-[#1A7F37] bg-[#DAFBE1]",
  del: "text-[#CF222E] bg-[#FFEBE9]",
  ctx: "",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto whitespace-pre rounded-ctl border border-foreman-line bg-[#F5F0E8] py-2 font-mono text-xs leading-[1.7] tabular-nums text-foreman-ink">
      {children}
    </div>
  );
}

// A unified-diff string, coloured line by line.
export function DiffView({ diff }: { diff: string }) {
  const lines = diff.replace(/\n$/, "").split("\n");
  return (
    <Shell>
      {lines.map((line, i) => (
        <span key={i} className={`block px-4 ${KIND_CLASS[classifyDiffLine(line)]}`}>
          {line === "" ? " " : line}
        </span>
      ))}
    </Shell>
  );
}

// Plain source (before/after preview panes) — no diff tinting.
export function PlainBlock({ text }: { text: string }) {
  const lines = text.replace(/\n$/, "").split("\n");
  return (
    <Shell>
      {lines.map((line, i) => (
        <span key={i} className="block px-4">
          {line === "" ? " " : line}
        </span>
      ))}
    </Shell>
  );
}

// A failure log — every line in fail-text (mock `.codeblock.faillog .ln`).
export function LogBlock({ text, tone = "fail" }: { text: string; tone?: "fail" | "plain" }) {
  const lines = text.replace(/\n$/, "").split("\n");
  const lineTone = tone === "fail" ? "text-foreman-fail-text" : "text-foreman-ink";
  return (
    <Shell>
      {lines.map((line, i) => (
        <span key={i} className={`block px-4 ${lineTone}`}>
          {line === "" ? " " : line}
        </span>
      ))}
    </Shell>
  );
}
