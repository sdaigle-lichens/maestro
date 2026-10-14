interface SyntaxLineProps {
  raw: string;
}

export default function SyntaxLine({ raw }: SyntaxLineProps) {
  if (raw === "---") return <span className="text-maestro-faint">{raw}</span>;
  const yaml = raw.match(/^([a-z_]+):\s?(.*)$/);
  if (yaml) {
    const [, k, v] = yaml;
    const isPlaceholder = v.includes("<");
    return (
      <>
        <span className="text-maestro-primary">{k}</span>
        <span className="text-maestro-muted">: </span>
        <span className={isPlaceholder ? "text-maestro-faint italic" : "text-maestro-muted"}>{v}</span>
      </>
    );
  }
  const json = raw.match(/^(\s*)"([^"]+)":\s?(.*)$/);
  if (json) {
    const [, indent, k, v] = json;
    const isPlaceholder = v.includes("<");
    return (
      <>
        <span>{indent}</span>
        <span className="text-maestro-muted">"</span>
        <span className="text-maestro-primary">{k}</span>
        <span className="text-maestro-muted">": </span>
        <span className={isPlaceholder ? "text-maestro-faint italic" : "text-maestro-muted"}>{v}</span>
      </>
    );
  }
  if (raw.startsWith("# ")) return <span className="text-maestro font-bold">{raw}</span>;
  if (raw.startsWith("## ")) return <span className="text-maestro-primary font-semibold">{raw}</span>;
  if (raw.startsWith("<")) return <span className="text-maestro-faint italic">{raw}</span>;
  return <span className="text-maestro-muted">{raw}</span>;
}
