import type { ReactNode } from "react";
import { FileCodeIcon, FileTextIcon } from "@phosphor-icons/react";
import SyntaxLine from "./syntax-line";

interface FilePreviewProps {
  label?: string;
  filename: string;
  path?: string;
  lines?: string[];
  children?: ReactNode;
}

export default function FilePreview({ label = "Template preview", filename, path, lines, children }: FilePreviewProps) {
  const FileIcon = filename.endsWith(".json") ? FileCodeIcon : FileTextIcon;
  return (
    <div className="h-full flex flex-col bg-maestro-faint gap-3 p-5">
      <div className="flex items-center gap-2">
        <div className="text-[11px] font-semibold tracking-[0.6px] text-maestro-muted uppercase">{label}</div>
        <div className="flex-1" />
        {path && <div className="font-mono text-[11px] text-maestro-faint">{path}</div>}
      </div>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-maestro-elevated rounded-[10px] border border-maestro shadow-[0_2px_10px_rgba(0,0,0,.03)]">
        <div className="h-[34px] flex items-center gap-1.5 px-2.5 shrink-0 bg-maestro-faint border-b border-maestro">
          <div className="flex gap-[5px] mr-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#e5b4a3]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#e9d394]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#a8d59f]" />
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-maestro-muted px-2.5 py-1 mt-1.5 bg-maestro-elevated border border-maestro border-b-0 rounded-t-[4px]">
            <FileIcon size={11} />
            {filename}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-3 font-mono text-xs leading-[1.7]">
          {lines
            ? lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[40px_1fr] pr-3">
                  <span className="text-maestro-faint opacity-55 text-right pr-3 text-[11px] select-none">{i + 1}</span>
                  <span className="whitespace-pre-wrap wrap-break-word">{l ? <SyntaxLine raw={l} /> : " "}</span>
                </div>
              ))
            : children}
        </div>
      </div>
    </div>
  );
}
