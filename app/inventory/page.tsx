"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  Loader2,
  PackageCheck,
  RotateCcw,
  ShoppingCart,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { fetchFullBomItemByPartNo, searchFullBomItems, type BomItem } from "@/lib/bom";
import {
  createLog,
  fetchLogs,
  updateLogStatus,
  type InventoryLog,
} from "@/lib/inventory";
import { useEmployeeGroup } from "@/lib/groups";
import { useTranslate } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RequireGroupPrompt } from "@/components/require-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LanguageSwitcher } from "@/components/language-switcher";

const zh: Record<string, string> = {
  "Spare Parts Inventory": "備品庫存管理",
  "Report missing/loaned parts and track them through to completion — everyone can see and update every record.":
    "回報缺料或借出零件,並追蹤到結案——所有人都能看到並更新所有紀錄。",
  "Back to Internal Tools": "回內部工具首頁",
  "Report a Part": "回報零件",
  Machine: "機台",
  "Select machine": "選擇機台",
  "(none)": "(不選)",
  "Part Name": "零件名稱",
  "Type a part number or description…": "輸入料號或說明…",
  "Type a part number or name…": "輸入料號或零件名稱…",
  "Found in Full BOM": "在完整 BOM 表中找到",
  "Not found in this machine's Full BOM — double-check the part number.": "在這台機台的完整 BOM 表中找不到——請再次確認料號是否正確。",
  Qty: "數量",
  Unit: "單位",
  "Mark as a loan (not a repair)": "標記為零件借出(非報修)",
  Borrower: "借用人",
  "Who's taking this part?": "是誰領走這個零件?",
  Submit: "提交",
  Submitting: "提交中…",
  "Part reported.": "已提交回報。",
  "Loan recorded.": "已記錄借出。",
  Active: "處理中",
  Archive: "已結案",
  "No records.": "沒有紀錄。",
  Reported: "回報人",
  "Mark as ordered": "標記為已下訂",
  "Mark as arrived": "標記為已到貨",
  "Mark as picked up / installed": "標記為已領取/已安裝",
  "Mark as completed": "核定結案",
  "Mark as returned": "標記為已歸還",
  "Waiting on the next step…": "等待下一步處理中…",
  missing: "缺料待訂",
  ordered: "採購中",
  arrived: "零件已到貨",
  picked_up: "已領取/運作中",
  completed: "已結案",
  loaned: "借出中",
  returned: "已歸還",
};

// Radix Select reserves an empty string value for "nothing selected"
// internally, so a real, clickable "blank" list item needs its own
// sentinel value rather than value="" — selecting it just resets
// selectedMachineName back to "".
const NONE_MACHINE_VALUE = "__none__";

export default function InventoryPage() {
  const t = useTranslate(zh);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  const { employeeId, allowedMachines, notFound, loading: groupLoading } = useEmployeeGroup();

  const [logs, setLogs] = useState<InventoryLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "archive">("active");
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  // Report form state
  const [selectedMachineName, setSelectedMachineName] = useState("");
  const [partName, setPartName] = useState("");
  const [isLoan, setIsLoan] = useState(false);
  const [borrower, setBorrower] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Live autocomplete against the selected machine's real Full BOM as the
  // user types — debounced (network call, not just an expensive render)
  // so it doesn't fire on every keystroke.
  const [debouncedPartName, setDebouncedPartName] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedPartName(partName), 300);
    return () => clearTimeout(timer);
  }, [partName]);

  const [suggestions, setSuggestions] = useState<BomItem[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const searchQuery = debouncedPartName.trim();
  const searchEligible = Boolean(selectedMachineName) && searchQuery.length >= 2;
  // Derived at render time rather than reset via a synchronous setState in
  // the effect below — once the query no longer qualifies for a search
  // (cleared, too short, or the machine changed), the last-fetched
  // suggestions are simply not shown, without needing an extra render
  // just to clear them out.
  const visibleSuggestions = searchEligible ? suggestions : [];

  useEffect(() => {
    if (!searchEligible) return;
    let cancelled = false;
    searchFullBomItems(getSupabase(), selectedMachineName, searchQuery)
      .then((items) => {
        if (!cancelled) setSuggestions(items);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [searchEligible, selectedMachineName, searchQuery]);

  // Whatever the Full BOM lookup last found (or didn't) for the exact text
  // currently in the part name field — set either by clicking a
  // suggestion directly (already known), or on blur for whatever was
  // typed without picking one. Cleared whenever the machine/part text
  // changes, so a stale result never lingers past the input it described.
  const [partLookup, setPartLookup] = useState<{ item: BomItem | null } | null>(null);
  const [partLookupLoading, setPartLookupLoading] = useState(false);

  async function handlePartNameBlur() {
    setSuggestionsOpen(false);
    const trimmed = partName.trim();
    if (!selectedMachineName || !trimmed) return;
    setPartLookupLoading(true);
    try {
      const item = await fetchFullBomItemByPartNo(getSupabase(), selectedMachineName, trimmed);
      setPartLookup({ item });
    } catch {
      // Best-effort — a failed lookup shouldn't block filling out the form.
      setPartLookup(null);
    } finally {
      setPartLookupLoading(false);
    }
  }

  function selectSuggestion(item: BomItem) {
    setPartName(item.part_no);
    setPartLookup({ item });
    setSuggestions([]);
    setSuggestionsOpen(false);
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      setLogs(await fetchLogs(getSupabase()));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!employeeId) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  const machineNames = Array.from(allowedMachines ?? []).sort();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!partName.trim()) return;

    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      await createLog(getSupabase(), {
        machineName: selectedMachineName,
        partName: partName.trim(),
        isLoan,
        borrower: isLoan ? borrower.trim() || null : null,
        reporterEmployeeId: employeeId,
      });
      setMessage(isLoan ? t("Loan recorded.") : t("Part reported."));
      setSelectedMachineName("");
      setPartName("");
      setPartLookup(null);
      setSuggestions([]);
      setIsLoan(false);
      setBorrower("");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusUpdate(log: InventoryLog, status: InventoryLog["status"]) {
    setUpdatingId(log.id);
    setError(null);
    try {
      await updateLogStatus(getSupabase(), log.id, status);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdatingId(null);
    }
  }

  if (groupLoading) return null;
  if (!employeeId || notFound) {
    return (
      <div className="bg-background min-h-screen">
        <RequireGroupPrompt notFound={notFound} employeeId={employeeId} />
      </div>
    );
  }

  const activeLogs = logs.filter((l) => l.status !== "completed" && l.status !== "returned");
  const archivedLogs = logs.filter((l) => l.status === "completed" || l.status === "returned");
  const visibleLogs = tab === "active" ? activeLogs : archivedLogs;

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("Spare Parts Inventory")}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("Report missing/loaned parts and track them through to completion — everyone can see and update every record.")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Button variant="outline" size="icon" asChild aria-label={t("Back to Internal Tools")}>
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        {error && <p className="text-destructive mb-4 text-sm">{error}</p>}

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{t("Report a Part")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4">
              <div className="grid gap-1.5">
                <label className="text-sm font-medium">{t("Machine")}</label>
                <Select
                  value={selectedMachineName || NONE_MACHINE_VALUE}
                  onValueChange={(v) => {
                    setSelectedMachineName(v === NONE_MACHINE_VALUE ? "" : v);
                    setPartName("");
                    setPartLookup(null);
                    setSuggestions([]);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("Select machine")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_MACHINE_VALUE}>{t("(none)")}</SelectItem>
                    {machineNames.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <label className="text-sm font-medium">{t("Part Name")}</label>
                <div className="relative">
                  <Input
                    required
                    placeholder={
                      selectedMachineName ? t("Type a part number or description…") : t("Type a part number or name…")
                    }
                    value={partName}
                    onChange={(e) => {
                      setPartName(e.target.value);
                      setPartLookup(null);
                      setSuggestionsOpen(true);
                    }}
                    onFocus={() => setSuggestionsOpen(true)}
                    onBlur={handlePartNameBlur}
                  />
                  {suggestionsOpen && visibleSuggestions.length > 0 && (
                    <div className="bg-popover absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-md border shadow-md">
                      {visibleSuggestions.map((item, idx) => (
                        <button
                          key={`${item.part_no}-${idx}`}
                          type="button"
                          className="hover:bg-accent block w-full px-3 py-2 text-left text-sm"
                          onMouseDown={(e) => {
                            // Keep the input focused through the click so
                            // this fires instead of the input's own blur
                            // (which would otherwise close the dropdown
                            // before the click registers).
                            e.preventDefault();
                            selectSuggestion(item);
                          }}
                        >
                          <div className="font-mono text-xs">{item.part_no}</div>
                          {item.description && (
                            <div className="text-muted-foreground truncate text-xs">{item.description}</div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {partLookupLoading && <p className="text-muted-foreground text-xs">…</p>}
                {partLookup && (
                  <div
                    className={cn(
                      "flex items-start gap-2 rounded-lg border p-2 text-xs",
                      partLookup.item
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
                        : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
                    )}
                  >
                    {partLookup.item ? (
                      <>
                        <CircleCheck className="h-3.5 w-3.5 shrink-0" />
                        <div>
                          <p className="font-medium">{t("Found in Full BOM")}</p>
                          <p>{partLookup.item.description}</p>
                          <p>
                            {t("Qty")} {partLookup.item.qty ?? "-"} · {t("Unit")} {partLookup.item.uom ?? "-"}
                          </p>
                        </div>
                      </>
                    ) : (
                      <>
                        <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                        <p>{t("Not found in this machine's Full BOM — double-check the part number.")}</p>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="bg-muted/50 grid gap-3 rounded-lg border p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox checked={isLoan} onCheckedChange={(v) => setIsLoan(v === true)} />
                  {t("Mark as a loan (not a repair)")}
                </label>
                {isLoan && (
                  <div className="grid gap-1.5">
                    <label className="text-sm font-medium">{t("Borrower")}</label>
                    <Input
                      required
                      placeholder={t("Who's taking this part?")}
                      value={borrower}
                      onChange={(e) => setBorrower(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {message && <p className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p>}

              <Button type="submit" disabled={submitting || !partName.trim()}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("Submitting")}
                  </>
                ) : (
                  t("Submit")
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="mb-4 inline-flex rounded-md border p-0.5">
          <Button
            type="button"
            size="sm"
            variant={tab === "active" ? "default" : "ghost"}
            className="h-7"
            onClick={() => setTab("active")}
          >
            {t("Active")} {activeLogs.length}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tab === "archive" ? "default" : "ghost"}
            className="h-7"
            onClick={() => setTab("archive")}
          >
            {t("Archive")} {archivedLogs.length}
          </Button>
        </div>

        {loading ? (
          <p className="text-muted-foreground text-sm">…</p>
        ) : visibleLogs.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">{t("No records.")}</p>
        ) : (
          <div className="grid gap-3">
            {visibleLogs.map((log) => (
              <Card key={log.id} className={cn(tab === "archive" && "opacity-70")}>
                <CardContent>
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid gap-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={statusBadgeVariant(log.status)}>{t(log.status)}</Badge>
                        <span className="font-medium">{log.partName}</span>
                      </div>
                      <p className="text-muted-foreground text-xs">{log.machineName || t("(none)")}</p>
                      {log.isLoan && log.borrower && (
                        <p className="text-muted-foreground text-xs">
                          {t("Borrower")}: {log.borrower}
                        </p>
                      )}
                      {log.reporterEmployeeId && (
                        <p className="text-muted-foreground text-xs">
                          {t("Reported")}: {log.reporterEmployeeId}
                        </p>
                      )}
                    </div>
                    <span className="text-muted-foreground shrink-0 text-xs whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleDateString()}
                    </span>
                  </div>

                  {tab === "active" && (
                    <div className="mt-3 border-t pt-3">
                      <StatusAction log={log} updating={updatingId === log.id} onUpdate={handleStatusUpdate} t={t} />
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function statusBadgeVariant(status: InventoryLog["status"]): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "missing":
      return "destructive";
    case "completed":
    case "returned":
      return "secondary";
    default:
      return "outline";
  }
}

function StatusAction({
  log,
  updating,
  onUpdate,
  t,
}: {
  log: InventoryLog;
  updating: boolean;
  onUpdate: (log: InventoryLog, status: InventoryLog["status"]) => void;
  t: (text: string) => string;
}) {
  const icon = updating ? <Loader2 className="h-4 w-4 animate-spin" /> : null;

  switch (log.status) {
    case "missing":
      return (
        <Button className="w-full" disabled={updating} onClick={() => onUpdate(log, "ordered")}>
          {icon ?? <ShoppingCart className="h-4 w-4" />} {t("Mark as ordered")}
        </Button>
      );
    case "ordered":
      return (
        <Button className="w-full" disabled={updating} onClick={() => onUpdate(log, "arrived")}>
          {icon ?? <Truck className="h-4 w-4" />} {t("Mark as arrived")}
        </Button>
      );
    case "arrived":
      return (
        <Button className="w-full" disabled={updating} onClick={() => onUpdate(log, "picked_up")}>
          {icon ?? <PackageCheck className="h-4 w-4" />} {t("Mark as picked up / installed")}
        </Button>
      );
    case "picked_up":
      return (
        <Button className="w-full" disabled={updating} onClick={() => onUpdate(log, "completed")}>
          {icon ?? <PackageCheck className="h-4 w-4" />} {t("Mark as completed")}
        </Button>
      );
    case "loaned":
      return (
        <Button className="w-full" disabled={updating} onClick={() => onUpdate(log, "returned")}>
          {icon ?? <RotateCcw className="h-4 w-4" />} {t("Mark as returned")}
        </Button>
      );
    default:
      return <p className="text-muted-foreground text-center text-xs">{t("Waiting on the next step…")}</p>;
  }
}
