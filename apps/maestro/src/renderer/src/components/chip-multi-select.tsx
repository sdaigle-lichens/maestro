export default function ChipMultiSelect({
  options,
  value,
  onChange,
  emptyText = "No options available.",
}: {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  emptyText?: string;
}) {
  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else onChange([...value, id]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.length === 0 ? (
        <span className="text-[12px] text-subtle">{emptyText}</span>
      ) : (
        options.map((o) => {
          const selected = value.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => toggle(o)}
              className={`px-2.5 py-1 rounded-full font-mono text-[12px] border cursor-pointer transition-colors focus:outline-none ${
                selected
                  ? "border-primary bg-(--primary-dim) text-(--ink)"
                  : "border-(--line) bg-(--bg-elev) text-(--ink-2) hover:border-(--ink-4)"
              }`}
            >
              {o}
            </button>
          );
        })
      )}
    </div>
  );
}
