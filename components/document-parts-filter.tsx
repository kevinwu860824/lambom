"use client";

import { ChevronDown } from "lucide-react";
import { DOCUMENT_PART_PREFIXES } from "@/lib/bom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTranslate } from "@/lib/i18n";

const zh: Record<string, string> = {
  "Document/Reference Parts": "文件 / 參考件",
  "All hidden": "全部隱藏",
  "All shown": "全部顯示",
  "{n}/{total} shown": "顯示 {n}/{total}",
  "Show all": "全部顯示",
};

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
  const t = useTranslate(zh);
  const allState: boolean | "indeterminate" =
    visibleCodes.size === 0 ? false : visibleCodes.size === DOCUMENT_PART_PREFIXES.length ? true : "indeterminate";

  return (
    <div className="grid gap-1.5">
      <label className="text-sm font-medium">{t("Document/Reference Parts")}</label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-9 w-fit justify-between gap-2 font-normal">
            <span className="truncate">
              {visibleCodes.size === 0
                ? t("All hidden")
                : visibleCodes.size === DOCUMENT_PART_PREFIXES.length
                  ? t("All shown")
                  : t("{n}/{total} shown")
                      .replace("{n}", String(visibleCodes.size))
                      .replace("{total}", String(DOCUMENT_PART_PREFIXES.length))}
            </span>
            <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
          <label className="flex items-center gap-2 border-b pb-1.5 text-sm font-medium">
            <Checkbox checked={allState} onCheckedChange={onToggleAll} />
            {t("Show all")}
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
