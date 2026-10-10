import type { ReactNode } from "react";

export interface ModePillOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface ModePillProps<T extends string> {
  options: ModePillOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export default function ModePill<T extends string>({ options, value, onChange }: ModePillProps<T>) {
  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  const trackWidth = `${100 / options.length}%`;
  const trackLeft = `calc(${(activeIndex / options.length) * 100}% + 3px)`;

  return (
    <div className="relative inline-flex p-[3px] rounded-full bg-maestro-faint border border-maestro">
      <div
        className="absolute top-[3px] bottom-[3px] rounded-full bg-maestro-elevated pointer-events-none transition-[left] duration-300 ease-[cubic-bezier(.2,.7,.3,1)] shadow-[0_1px_2px_rgba(0,0,0,.06),0_0_0_1px_var(--border)]"
        style={{ width: `calc(${trackWidth} - 6px)`, left: trackLeft }}
      />
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`relative z-10 inline-flex items-center gap-1.5 px-3.5 py-[5px] rounded-full text-xs font-semibold cursor-pointer transition-colors duration-200 focus:outline-none focus:shadow-none ${
            opt.value === value ? "text-maestro" : "text-maestro-muted"
          }`}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
