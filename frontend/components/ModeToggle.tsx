export type SeamMode = "guided" | "autonomous";

interface ModeToggleProps {
  mode: SeamMode;
  onChange: (mode: SeamMode) => void;
}

export default function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <div className="inline-flex rounded-lg border border-slate-800 overflow-hidden">
      {(["guided", "autonomous"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
            mode === option
              ? "bg-blue-600 text-white"
              : "bg-slate-900 text-slate-400 hover:text-slate-200"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
