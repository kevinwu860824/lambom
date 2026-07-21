"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PRESET_COLORS } from "@/components/color-picker-popover";
import { cn } from "@/lib/utils";

/** Single popover for both renaming a category and changing its color. */
export function CategoryEditPopover({
  category,
  color,
  onRename,
  onColorChange,
  children,
}: {
  category: string;
  color: string | null;
  onRename: (newName: string) => Promise<void>;
  onColorChange: (color: string | null) => Promise<void>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(category);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function commitName() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === category) return;
    setSaving(true);
    setError(null);
    try {
      await onRename(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDraft(category);
    } finally {
      setSaving(false);
    }
  }

  async function pickColor(c: string | null) {
    setSaving(true);
    setError(null);
    try {
      await onColorChange(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraft(category);
          setError(null);
        }
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64">
        <p className="mb-1 text-xs font-medium">分類名稱</p>
        <div className="mb-3 flex items-center gap-2">
          <Input
            value={draft}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") setDraft(category);
            }}
          />
          <Button size="sm" disabled={saving} onClick={commitName}>
            確定
          </Button>
        </div>

        <p className="mb-2 text-xs font-medium">分類顏色</p>
        <div className="mb-3 grid grid-cols-4 gap-2">
          {PRESET_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              title={c.label}
              disabled={saving}
              onClick={() => pickColor(c.value)}
              className={cn(
                "h-7 w-7 rounded-full border-2",
                color === c.value ? "border-foreground" : "border-transparent"
              )}
              style={{ backgroundColor: c.value }}
            />
          ))}
        </div>
        <div className="mb-3 flex items-center gap-2">
          <input
            type="color"
            disabled={saving}
            defaultValue={color && color.startsWith("#") ? color : "#dbeafe"}
            onChange={(e) => pickColor(e.target.value)}
            className="h-7 w-10 cursor-pointer rounded border"
          />
          <span className="text-muted-foreground text-xs">自訂顏色</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="w-full"
          disabled={saving}
          onClick={() => pickColor(null)}
        >
          恢復自動配色
        </Button>

        {error && <p className="text-destructive mt-2 text-xs">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}
