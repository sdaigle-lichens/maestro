// The "Create" entry point at the bottom of Marketplace/Plugins/Agents/Skills tabs.
//
// This is where the removed top-nav `Create` dropdown's four destinations relocated to — each
// tab now offers the one `create-*` route relevant to what it just showed.

import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";

export default function CreateLink({
  to,
  label,
}: {
  to: "/create-marketplace" | "/create-plugin" | "/create-subagent" | "/create-skill";
  label: string;
}) {
  return (
    <div className="pt-2">
      <Link
        to={to}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] border bg-(--bg-elev) border-(--line) text-(--ink-2) hover:text-(--ink) hover:border-primary no-underline"
      >
        <Plus size={13} /> {label}
      </Link>
    </div>
  );
}
