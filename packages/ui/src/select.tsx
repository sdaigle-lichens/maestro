import { Select as BaseSelect } from "@base-ui/react/select";
import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react";

export interface SelectOption {
  id: string;
  name: string;
  desc?: string;
}

interface SelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
}

export default function Select({ id, value, onChange, options, placeholder }: SelectProps) {
  const current = options.find((o) => o.id === value);
  return (
    <BaseSelect.Root value={value} onValueChange={(v) => onChange(v as string)}>
      <BaseSelect.Trigger
        id={id}
        className="w-full h-10 px-3 rounded-lg bg-maestro-elevated box-border cursor-pointer flex items-center gap-2 transition-all duration-150 focus:outline-none focus:shadow-none border-[1.5px] border-maestro data-[popup-open]:border-maestro-primary-strong data-[popup-open]:shadow-[0_0_0_3px_var(--primary-bg)]"
      >
        <span className={`flex-1 text-left text-sm ${current ? "text-maestro" : "text-maestro-faint"}`}>
          {current ? current.name : placeholder || "Choose…"}
        </span>
        <CaretDownIcon size={14} aria-hidden />
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-20 outline-none">
          <BaseSelect.Popup className="bg-maestro-elevated rounded-lg border border-maestro p-1 max-h-[280px] overflow-y-auto shadow-[0_8px_24px_rgba(0,0,0,.08),0_2px_6px_rgba(0,0,0,.04)] min-w-[var(--anchor-width)] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-100">
            {options.map((opt) => (
              <BaseSelect.Item
                key={opt.id}
                value={opt.id}
                className="block w-full box-border text-left px-2.5 py-2 rounded-md cursor-pointer focus:outline-none focus:shadow-none data-[highlighted]:bg-maestro-primary-subtle data-[selected]:bg-maestro-primary-subtle"
              >
                <div className="flex items-center gap-2 text-[13px] font-medium text-maestro">
                  <BaseSelect.ItemText>{opt.name}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator>
                    <CheckIcon size={12} weight="bold" aria-hidden />
                  </BaseSelect.ItemIndicator>
                </div>
                {opt.desc && <div className="text-[11px] text-maestro-muted mt-0.5">{opt.desc}</div>}
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
