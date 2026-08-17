"use client";

import { useState } from "react";
import { Palette } from "lucide-react";
import { useTranslate } from "@/lib/i18n";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const zh: Record<string, string> = {
  Blue: "藍色",
  Amber: "琥珀色",
  Emerald: "祖母綠",
  Violet: "紫羅蘭色",
  Rose: "玫瑰色",
  Cyan: "青色",
  Lime: "萊姆色",
  Orange: "橘色",
  "Select Color": "選擇顏色",
  "Custom Color": "自訂顏色",
  "Restore Automatic Color": "恢復自動顏色",
};

export const PRESET_COLORS = [
  { label: "Blue", value: "#dbeafe" },
  { label: "Amber", value: "#fef3c7" },
  { label: "Emerald", value: "#d1fae5" },
  { label: "Violet", value: "#ede9fe" },
  { label: "Rose", value: "#ffe4e6" },
  { label: "Cyan", value: "#cffafe" },
  { label: "Lime", value: "#ecfccb" },
  { label: "Orange", value: "#ffedd5" },
];

export function ColorSwatchTrigger({
  color,
  ...props
}: { color: string | null } & Omit<React.ComponentProps<"button">, "color">) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="h-9 w-9 shrink-0 p-0"
      {...props}
    >
      {color ? (
        <span
          className="block h-5 w-5 rounded-full border"
          style={{ backgroundColor: color }}
        />
      ) : (
        <Palette className="text-muted-foreground h-4 w-4" />
      )}
    </Button>
  );
}

export function ColorPickerPopover({
  value,
  onChange,
  children,
}: {
  value: string | null;
  onChange: (color: string | null) => void | Promise<void>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslate(zh);

  async function pick(color: string | null) {
    setSaving(true);
    setError(null);
    try {
      await onChange(color);
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
        if (next) setError(null);
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-56">
        <p className="mb-2 text-xs font-medium">{t("Select Color")}</p>
        <div className="mb-3 grid grid-cols-4 gap-2">
          {PRESET_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              title={t(c.label)}
              disabled={saving}
              onClick={() => pick(c.value)}
              className={cn(
                "h-7 w-7 rounded-full border-2",
                value === c.value ? "border-foreground" : "border-transparent"
              )}
              style={{ backgroundColor: c.value }}
            />
          ))}
        </div>
        <div className="mb-3 flex items-center gap-2">
          <input
            type="color"
            disabled={saving}
            defaultValue={value && value.startsWith("#") ? value : "#dbeafe"}
            onChange={(e) => pick(e.target.value)}
            className="h-7 w-10 cursor-pointer rounded border"
          />
          <span className="text-muted-foreground text-xs">{t("Custom Color")}</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="w-full"
          disabled={saving}
          onClick={() => pick(null)}
        >
          {t("Restore Automatic Color")}
        </Button>
        {error && <p className="text-destructive mt-2 text-xs">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}
