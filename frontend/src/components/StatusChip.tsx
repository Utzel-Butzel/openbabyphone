import clsx from "clsx";

type Tone = "neutral" | "live" | "warning" | "danger";

const toneMap: Record<Tone, string> = {
  neutral: "bg-white/8 text-white/80",
  live: "bg-emerald-400/15 text-emerald-100 ring-1 ring-emerald-300/25",
  warning: "bg-amber-300/15 text-amber-100 ring-1 ring-amber-200/25",
  danger: "bg-rose-400/15 text-rose-100 ring-1 ring-rose-300/25",
};

const dotMap: Record<Tone, string> = {
  neutral: "bg-slate-300/70",
  live: "bg-emerald-300",
  warning: "bg-amber-300",
  danger: "bg-rose-300",
};

interface StatusChipProps {
  label: string;
  tone?: Tone;
}

export function StatusChip({ label, tone = "neutral" }: StatusChipProps) {
  return (
    <div
      className={clsx(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium",
        toneMap[tone],
      )}
    >
      <span className={clsx("status-dot", dotMap[tone])} />
      <span>{label}</span>
    </div>
  );
}
