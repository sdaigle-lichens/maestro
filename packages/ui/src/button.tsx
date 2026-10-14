import type { ReactNode } from "react";
import { CircleNotchIcon } from "@phosphor-icons/react";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps {
  children: ReactNode;
  variant?: Variant;
  onClick?: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  loading?: boolean;
  type?: "button" | "submit";
  className?: string;
}

const variantClasses: Record<Variant, string> = {
  primary: "bg-maestro-primary text-white border-maestro-primary-strong hover:brightness-95 shadow-(--shadow-1)",
  secondary: "bg-maestro-elevated text-maestro border-maestro hover:bg-maestro-faint",
  ghost: "bg-transparent text-maestro-muted border-transparent hover:bg-maestro-faint",
};

function Spinner({ size = 13 }: { size?: number }) {
  return <CircleNotchIcon size={size} weight="bold" className="shrink-0 animate-spin" />;
}

export default function Button({
  children,
  variant = "ghost",
  onClick,
  disabled,
  icon,
  loading,
  type = "button",
  className = "",
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      className={`inline-flex items-center gap-2 h-9 px-3.5 rounded-lg text-[13px] font-semibold border box-border transition-all duration-150 ${
        isDisabled
          ? "bg-maestro-faint text-maestro-faint border-maestro cursor-not-allowed opacity-60"
          : `cursor-pointer ${variantClasses[variant]}`
      } ${className}`}
    >
      {loading ? <Spinner /> : icon}
      <span>{children}</span>
    </button>
  );
}
