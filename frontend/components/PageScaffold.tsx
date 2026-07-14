// Shared page frame (foreman.css `.page` / `.page-title` / `.page-sub`).
// Each of the six dashboard pages is fully built in Phases 4-7; for Phase 3
// they render this frame around a live-wired placeholder so navigation, the
// shell, and the shared socket can be verified end to end.

export default function PageScaffold({
  title,
  sub,
  wide,
  children,
}: {
  title: string;
  sub?: string;
  wide?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={`p-8 ${wide ? "" : "max-w-[1200px]"}`}>
      <h1 className="mb-1 text-lg font-bold tracking-[-0.01em]">{title}</h1>
      {sub && <p className="mb-6 text-[13px] text-foreman-dim">{sub}</p>}
      {children}
    </div>
  );
}

// A neutral "wired but not yet built" card so a scaffold reads as intentional
// rather than broken. Removed as each page's real content lands.
export function PhaseNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-[#D6C9B5] bg-foreman-card p-6 text-[13px] text-foreman-dim">
      {children}
    </div>
  );
}
