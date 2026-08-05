"use client";

import { ChevronDown } from "lucide-react";
import { DOCUMENT_PART_PREFIXES } from "@/lib/bom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Per-code checklist (in a collapsible popover, matching the app's
 * existing Subparts-picker pattern) for revealing document/reference part
 * numbers that are hidden by default — see DOCUMENT_PART_PREFIXES. */
export function DocumentPartsFilter({
  visibleCodes,
  onToggle,
  onToggleAll,
}: {
  visibleCodes: Set<string>;
  onToggle: (code: string) => void;
  onToggleAll: () => void;
}) {
  const allState: boolean | "indeterminate" =
    visibleCodes.size === 0 ? false : visibleCodes.size === DOCUMENT_PART_PREFIXES.length ? true : "indeterminate";

  return (
    <div className="grid gap-1.5">
      <label className="text-sm font-medium">Document/Reference Parts</label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-9 w-fit justify-between gap-2 font-normal">
            <span className="truncate">
              {visibleCodes.size === 0
                ? "All hidden"
                : visibleCodes.size === DOCUMENT_PART_PREFIXES.length
                  ? "All shown"
                  : `${visibleCodes.size}/${DOCUMENT_PART_PREFIXES.length} shown`}
            </span>
            <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
          <label className="flex items-center gap-2 border-b pb-1.5 text-sm font-medium">
            <Checkbox checked={allState} onCheckedChange={onToggleAll} />
            Show all
          </label>
          <div className="mt-1.5 grid gap-1">
            {DOCUMENT_PART_PREFIXES.map(({ code, label }) => (
              <label key={code} className="hover:bg-accent flex items-center gap-2 rounded px-1 py-1 text-sm">
                <Checkbox checked={visibleCodes.has(code)} onCheckedChange={() => onToggle(code)} />
                <span className="font-mono text-xs">{code}</span>
                <span className="text-muted-foreground">{label}</span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
