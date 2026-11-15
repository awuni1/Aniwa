"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

// A section that stays folded until clicked, so long panels show their
// headings first and the details on demand.
export default function Collapsible({
  title,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-white/[0.06]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-[12px] font-medium text-white/80 transition-colors hover:bg-white/[0.03] hover:text-white"
      >
        {icon}
        <span className="flex-1">{title}</span>
        <ChevronDown size={14} className={`text-white/55 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="-mt-3">{children}</div>}
    </div>
  );
}
