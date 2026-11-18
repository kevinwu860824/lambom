"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslate } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

const zh: Record<string, string> = {
  "Copy part number": "複製料號",
  Copied: "已複製",
};

/**
 * Small copy-to-clipboard icon button for a part number — part numbers are
 * almost always inside something else that reacts to clicks (a tree row's
 * expand/collapse, a Fingerprint cell's "where is this part" dialog), so
 * selecting the text by hand to copy it is fiddly and prone to triggering
 * the wrong thing. stopPropagation + preventDefault keep this button from
 * triggering whatever it's nested inside.
 */
export function CopyButton({ value, className }: { value: string; className?: string }) {
  const t = useTranslate(zh);
  const [copied, setCopied] = useState(false);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail (permissions, insecure context) — not worth
      // surfacing an error for a convenience action; the button just won't
      // show the "copied" confirmation.
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className={className ?? "text-muted-foreground shrink-0"}
      aria-label={copied ? t("Copied") : t("Copy part number")}
      onClick={handleClick}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}
