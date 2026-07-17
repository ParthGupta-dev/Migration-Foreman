"use client";

export default function CampaignBar({
  label,
  hint,
  starting,
  disabled,
  onStart,
}: {
  label: string;
  hint: string;
  starting: boolean;
  disabled: boolean;
  onStart: () => void;
}) {
  return (
    <div
      className="flex items-center gap-4 rounded-2xl border border-foreman-line bg-foreman-card px-[18px] py-3.5"
      style={{ boxShadow: "0 1px 2px rgba(16,24,40,0.05), 0 8px 24px rgba(16,24,40,0.06)" }}
    >
      <div>
        <p className="text-sm font-semibold text-foreman-ink">{label}</p>
        <p className="mt-0.5 text-xs text-foreman-dim">{hint}</p>
      </div>
      <button
        type="button"
        disabled={disabled || starting}
        onClick={onStart}
        className="ml-auto rounded-ctl bg-foreman-primary px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#5A4A3A] disabled:opacity-50"
      >
        {starting ? "Starting…" : "Start campaign"}
      </button>
    </div>
  );
}
