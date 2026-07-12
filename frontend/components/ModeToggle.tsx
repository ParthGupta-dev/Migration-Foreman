export type SeamMode = "plan" | "guided" | "autonomous";

const MODE_LABELS: Record<SeamMode, string> = {
  plan: "AI Plan",
  guided: "Guided",
  autonomous: "Autonomous",
};

interface ModeToggleProps {
  mode: SeamMode;
  onChange: (mode: SeamMode) => void;
}

export default function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <div className="inline-flex rounded-lg border border-slate-800 overflow-hidden">
      {(Object.keys(MODE_LABELS) as SeamMode[]).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            mode === option
              ? "bg-blue-600 text-white"
              : "bg-slate-900 text-slate-400 hover:text-slate-200"
          }`}
        >
          {MODE_LABELS[option]}
        </button>
      ))}
    </div>
  );
}
