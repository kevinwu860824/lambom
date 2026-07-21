"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RenamePopover({
  value,
  onSave,
  triggerLabel,
}: {
  value: string;
  onSave: (newValue: string) => Promise<void>;
  triggerLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function commit() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value) {
      setOpen(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
      setOpen(false);
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
          setDraft(value);
          setError(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          className="text-muted-foreground hover:text-foreground"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64">
        <p className="mb-2 text-xs font-medium">{triggerLabel}</p>
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setOpen(false);
            }}
            autoFocus
          />
          <Button size="sm" disabled={saving} onClick={commit}>
            確定
          </Button>
        </div>
        {error && <p className="text-destructive mt-2 text-xs">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}
