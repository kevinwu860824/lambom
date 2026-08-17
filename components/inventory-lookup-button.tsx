"use client";

import { useEffect, useState } from "react";
import { Loader2, Warehouse } from "lucide-react";
import { isInventoryLookupAvailable, lookupInventory } from "@/lib/inventory-lookup";
import { Button } from "@/components/ui/button";
import { useTranslate } from "@/lib/i18n";

const zh: Record<string, string> = {
  "Look up inventory in SAP": "在 SAP 查詢庫存",
};

/**
 * Only renders inside the lambom desktop app — checked in a useEffect (not
 * during render) so server-rendered and first-client-render markup match;
 * a regular browser tab never sees this button at all, same as
 * FidDownloaderPanel's `available` gate.
 */
export function InventoryLookupButton({ partNo, className }: { partNo: string; className?: string }) {
  const t = useTranslate(zh);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setAvailable(isInventoryLookupAvailable());
  }, []);

  if (!available) return null;

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (loading) return;
    setLoading(true);
    try {
      await lookupInventory(partNo);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className={className ?? "text-muted-foreground shrink-0"}
      aria-label={t("Look up inventory in SAP")}
      disabled={loading}
      onClick={handleClick}
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Warehouse className="h-3 w-3" />}
    </Button>
  );
}
