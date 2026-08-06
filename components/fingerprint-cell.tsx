"use client";

import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Lightweight blur-to-save cell editor for the fingerprint matrix — unlike
 * EditableField (which needs an explicit confirm click, meant for a single
 * rename field), a dense grid with many columns wants "type, tab/click
 * away, it's saved" like a spreadsheet.
 */
export function FingerprintCell({
  value,
  onSave,
  mismatch,
  readOnly,
  foundInModules,
}: {
  value: string;
  onSave: (newValue: string) => Promise<void>;
  mismatch?: boolean;
  readOnly?: boolean;
  /** Modules (source_file names) this part number was also found in when
   * last validated via the Excel template upload — shown as a small icon
   * with a tooltip listing them. */
  foundInModules?: string[] | null;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  async function commit() {
    const trimmed = draft.trim();
    if (trimmed === value) return;

    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDraft(value);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-w-[140px]">
      <div className="flex items-center gap-1">
        <input
          value={draft}
          disabled={saving}
          readOnly={readOnly}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setDraft(value);
          }}
          className={cn(
            "w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm outline-none",
            !readOnly &&
              "hover:border-input focus:border-ring focus:ring-ring/30 focus:bg-background focus:ring-2",
            saving && "opacity-50",
            error && "border-destructive",
            mismatch && "text-red-600 font-semibold"
          )}
        />
        {foundInModules && foundInModules.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-muted-foreground shrink-0 pr-1">
                <Layers className="h-3 w-3" />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-medium">Also found in:</p>
              <ul className="mt-0.5 list-disc pl-3">
                {foundInModules.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      {error && <p className="text-destructive px-1.5 text-xs">{error}</p>}
    </div>
  );
}
