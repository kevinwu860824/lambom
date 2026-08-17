"use client";

import { useEffect, useState } from "react";
import { Check, X as XIcon } from "lucide-react";
import { useTranslate } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const zh: Record<string, string> = {
  Saved: "已儲存",
};

export function EditableField({
  value,
  onSave,
}: {
  value: string;
  onSave: (newValue: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const t = useTranslate(zh);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const isDirty = draft.trim() !== value && draft.trim().length > 0;

  async function commit() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value) return;

    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await onSave(trimmed);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          disabled={saving}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setDraft(value);
          }}
        />
        {isDirty && (
          <Button size="icon-sm" variant="outline" disabled={saving} onClick={commit}>
            <Check className="h-4 w-4" />
          </Button>
        )}
        {isDirty && (
          <Button size="icon-sm" variant="ghost" disabled={saving} onClick={() => setDraft(value)}>
            <XIcon className="h-4 w-4" />
          </Button>
        )}
        {saved && <span className="text-xs text-emerald-600">{t("Saved")}</span>}
      </div>
      {error && <p className="text-destructive mt-1 text-xs">{error}</p>}
    </div>
  );
}
