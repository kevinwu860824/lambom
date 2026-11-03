"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  Loader2,
  PackageCheck,
  Pencil,
  RotateCcw,
  ShoppingCart,
  Trash2,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { fetchFullBomItemByPartNo, searchFullBomItems, type BomItem } from "@/lib/bom";
import {
  createLog,
  deleteStockItem,
  fetchLogs,
  fetchStock,
  updateLogStatus,
  upsertStockItem,
  type InventoryLog,
  type StockItem,
} from "@/lib/inventory";
import { useEmployeeGroup } from "@/lib/groups";
import { useTranslate } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RequireGroupPrompt } from "@/components/require-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LanguageSwitcher } from "@/components/language-switcher";

const zh: Record<string, string> = {
  "Spare Parts Inventory": "備品庫存管理",
  "Report missing/loaned parts and track them through to completion — records are shared within your active group.":
    "回報缺料或借出零件並追蹤結案——紀錄只會在目前群組內共用。",
  "Back to Internal Tools": "回內部工具首頁",
  "Report a Part": "回報零件",
  Machine: "機台",
  "Select machine": "選擇機台",
  "(none)": "(不選)",
  "Part Name": "零件名稱",
  "Type a part number or description…": "輸入料號或說明…",
  "Type a part number or name…": "輸入料號或零件名稱…",
  "+{count} more match — type more to narrow down": "還有 {count} 筆相符,請輸入更多字元縮小範圍",
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
  Stock: "庫存",
  "No records.": "沒有紀錄。",
  Status: "狀態",
  Details: "詳細資訊",
  Date: "日期",
  Actions: "操作",
  Updated: "更新時間",
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
  "Add / Update Stock": "新增/更新庫存",
  "Part Number": "料號",
  Description: "說明",
  Quantity: "數量",
  Note: "備註",
  Save: "儲存",
  Edit: "編輯",
  Delete: "刪除",
  "No stock recorded yet.": "目前沒有庫存紀錄。",
  "Delete this stock item?": "確定要刪除這筆庫存紀錄嗎?",
};

// Radix Select reserves an empty string value for "nothing selected"
// internally, so a real, clickable "blank" list item needs its own
// sentinel value rather than value="" — selecting it just resets
// selectedMachineName back to "".
const NONE_MACHINE_VALUE = "__none__";

type SupabaseClient = ReturnType<typeof createClient>;

/** Debounced live autocomplete against one machine's real Full BOM, for
 * the Report form's Part Name field. `enabled` gates the case where no
 * machine has been chosen yet — searching requires a machine_name filter
 * to stay fast (see searchFullBomItems), so there's nothing to search
 * against until one is picked. */
function usePartSearch(supabase: SupabaseClient, machineName: string, enabled: boolean) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const [suggestions, setSuggestions] = useState<BomItem[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const trimmed = debounced.trim();
  const eligible = enabled && trimmed.length >= 2;
  // Derived at render time rather than reset via a synchronous setState in
  // the effect below — once the query no longer qualifies for a search,
  // the last-fetched suggestions are simply not shown.
  const visible = eligible ? suggestions : [];
  const truncatedCount = eligible ? Math.max(0, total - suggestions.length) : 0;

  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    searchFullBomItems(supabase, machineName, trimmed)
      .then((result) => {
        if (!cancelled) {
          setSuggestions(result.items);
          setTotal(result.totalMatches);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSuggestions([]);
          setTotal(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [eligible, machineName, trimmed, supabase]);

  return {
    query,
    setQuery,
    open,
    setOpen,
    suggestions: visible,
    truncatedCount,
    reset: () => {
      setQuery("");
      setSuggestions([]);
      setTotal(0);
      setOpen(false);
    },
  };
}

type PartSearchState = ReturnType<typeof usePartSearch>;

/** The combobox UI shared by the Report form's Part Name field and the
 * Stock tab's Part Number field — same input-plus-dropdown markup, same
 * onMouseDown+preventDefault trick (so a suggestion click registers before
 * the input's own blur would otherwise close the dropdown first). */
function PartSearchCombobox({
  search,
  onChange,
  onSelect,
  onBlur,
  placeholder,
  t,
}: {
  search: PartSearchState;
  onChange: (value: string) => void;
  onSelect: (item: BomItem) => void;
  onBlur?: () => void;
  placeholder: string;
  t: (text: string) => string;
}) {
  return (
    <div className="relative">
      <Input
        required
        placeholder={placeholder}
        value={search.query}
        onChange={(e) => {
          onChange(e.target.value);
          search.setOpen(true);
        }}
        onFocus={() => search.setOpen(true)}
        onBlur={onBlur}
      />
      {search.open && search.suggestions.length > 0 && (
        <div className="bg-popover absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-md border shadow-md">
          {search.suggestions.map((item, idx) => (
            <button
              key={`${item.part_no}-${idx}`}
              type="button"
              className="hover:bg-accent block w-full px-3 py-2 text-left text-sm"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(item);
              }}
            >
              <div className="font-mono text-xs">{item.part_no}</div>
              {item.description && <div className="text-muted-foreground truncate text-xs">{item.description}</div>}
            </button>
          ))}
          {search.truncatedCount > 0 && (
            <p className="text-muted-foreground border-t px-3 py-1.5 text-xs">
              {t("+{count} more match — type more to narrow down").replace("{count}", String(search.truncatedCount))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Machine picker shared by the Report form and the Stock form — both let
 * "(none)" stay selected (searchFullBomItems then stays disabled rather
 * than falling back to an unscoped, unsafely-slow search). */
function MachineSelect({
  value,
  onChange,
  machineNames,
  t,
}: {
  value: string;
  onChange: (value: string) => void;
  machineNames: string[];
  t: (text: string) => string;
}) {
  return (
    <Select value={value || NONE_MACHINE_VALUE} onValueChange={(v) => onChange(v === NONE_MACHINE_VALUE ? "" : v)}>
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
  );
}

/** The "found in this machine's Full BOM" / "not found" banner shared by
 * the Report form and the Stock form — same green/amber treatment either
 * way, so a part that isn't actually on the selected machine is flagged
 * consistently no matter which form it's typed into. */
function PartLookupBanner({
  lookup,
  loading,
  t,
}: {
  lookup: { item: BomItem | null } | null;
  loading: boolean;
  t: (text: string) => string;
}) {
  return (
    <>
      {loading && <p className="text-muted-foreground text-xs">…</p>}
      {lookup && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border p-2 text-xs",
            lookup.item
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
              : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
          )}
        >
          {lookup.item ? (
            <>
              <CircleCheck className="h-3.5 w-3.5 shrink-0" />
              <div>
                <p className="font-medium">{t("Found in Full BOM")}</p>
                <p>{lookup.item.description}</p>
                <p>
                  {t("Qty")} {lookup.item.qty ?? "-"} · {t("Unit")} {lookup.item.uom ?? "-"}
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
    </>
  );
}

export default function InventoryPage() {
  const t = useTranslate(zh);
  const supabaseRef = useRef<SupabaseClient | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  const { employeeId, group, allowedMachines, notFound, loading: groupLoading } = useEmployeeGroup();

  const [logs, setLogs] = useState<InventoryLog[]>([]);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "archive" | "stock">("active");
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  // Report form state
  const [selectedMachineName, setSelectedMachineName] = useState("");
  const [isLoan, setIsLoan] = useState(false);
  const [borrower, setBorrower] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reportSearch = usePartSearch(getSupabase(), selectedMachineName, Boolean(selectedMachineName));

  // Whatever the Full BOM lookup last found (or didn't) for the exact text
  // currently in the part name field — set either by clicking a
  // suggestion directly (already known), or on blur for whatever was
  // typed without picking one. Cleared whenever the machine/part text
  // changes, so a stale result never lingers past the input it described.
  const [partLookup, setPartLookup] = useState<{ item: BomItem | null } | null>(null);
  const [partLookupLoading, setPartLookupLoading] = useState(false);

  async function handlePartNameBlur() {
    reportSearch.setOpen(false);
    const trimmed = reportSearch.query.trim();
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

  function selectReportSuggestion(item: BomItem) {
    reportSearch.setQuery(item.part_no);
    setPartLookup({ item });
    reportSearch.setOpen(false);
  }

  // Stock form state — mirrors the Report form exactly: a machine picker
  // (optional, defaults to none) drives the same Full BOM search/
  // suggestions/found-banner, and the chosen machine is saved on the row
  // as which machine this stock entry was requested because of.
  const [stockMachineName, setStockMachineName] = useState("");
  const stockSearch = usePartSearch(getSupabase(), stockMachineName, Boolean(stockMachineName));
  const [stockPartLookup, setStockPartLookup] = useState<{ item: BomItem | null } | null>(null);
  const [stockPartLookupLoading, setStockPartLookupLoading] = useState(false);
  const [stockDescription, setStockDescription] = useState("");
  const [stockQty, setStockQty] = useState("1");
  const [stockNote, setStockNote] = useState("");
  const [stockSubmitting, setStockSubmitting] = useState(false);

  async function handleStockPartBlur() {
    stockSearch.setOpen(false);
    const trimmed = stockSearch.query.trim();
    if (!stockMachineName || !trimmed) return;
    setStockPartLookupLoading(true);
    try {
      const item = await fetchFullBomItemByPartNo(getSupabase(), stockMachineName, trimmed);
      setStockPartLookup({ item });
    } catch {
      setStockPartLookup(null);
    } finally {
      setStockPartLookupLoading(false);
    }
  }

  function selectStockSuggestion(item: BomItem) {
    stockSearch.setQuery(item.part_no);
    setStockDescription(item.description ?? "");
    setStockPartLookup({ item });
    stockSearch.setOpen(false);
  }

  function editStockItem(item: StockItem) {
    setStockMachineName(item.machineName);
    stockSearch.setQuery(item.partNo);
    setStockPartLookup(null);
    setStockDescription(item.description ?? "");
    setStockQty(String(item.qty));
    setStockNote(item.note ?? "");
  }

  async function handleStockSubmit(e: React.FormEvent) {
    e.preventDefault();
    const partNo = stockSearch.query.trim();
    const groupId = group?.id;
    if (!partNo || groupId == null) return;

    setStockSubmitting(true);
    setError(null);
    try {
      await upsertStockItem(getSupabase(), {
        groupId,
        partNo,
        machineName: stockMachineName,
        description: stockDescription.trim() || null,
        qty: Math.max(0, Math.round(Number(stockQty) || 0)),
        note: stockNote.trim() || null,
      });
      setStockMachineName("");
      stockSearch.reset();
      setStockPartLookup(null);
      setStockDescription("");
      setStockQty("1");
      setStockNote("");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStockSubmitting(false);
    }
  }

  async function handleDeleteStock(id: number) {
    if (!group) return;
    if (!window.confirm(t("Delete this stock item?"))) return;
    try {
      await deleteStockItem(getSupabase(), id, group.id);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadAll() {
    const groupId = group?.id;
    if (groupId == null) {
      setLogs([]);
      setStock([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [logsData, stockData] = await Promise.all([
        fetchLogs(getSupabase(), groupId),
        fetchStock(getSupabase(), groupId),
      ]);
      setLogs(logsData);
      setStock(stockData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!employeeId || !group) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, group?.id]);

  const machineNames = Array.from(allowedMachines ?? []).sort();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const groupId = group?.id;
    if (!reportSearch.query.trim() || groupId == null) return;

    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      await createLog(getSupabase(), {
        groupId,
        machineName: selectedMachineName,
        partName: reportSearch.query.trim(),
        isLoan,
        borrower: isLoan ? borrower.trim() || null : null,
        reporterEmployeeId: employeeId,
      });
      setMessage(isLoan ? t("Loan recorded.") : t("Part reported."));
      setSelectedMachineName("");
      reportSearch.reset();
      setPartLookup(null);
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
    if (!group) return;
    setUpdatingId(log.id);
    setError(null);
    try {
      await updateLogStatus(getSupabase(), log.id, status, group.id);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdatingId(null);
    }
  }

  if (groupLoading) return null;
  if (!employeeId || notFound || !group) {
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
      <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("Spare Parts Inventory")}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("Report missing/loaned parts and track them through to completion — records are shared within your active group.")}
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

        <div className="mb-6 grid">
          <Card
            aria-hidden={tab === "stock"}
            className={cn("col-start-1 row-start-1", tab === "stock" && "invisible")}
          >
            <CardHeader>
              <CardTitle>{t("Report a Part")}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="grid gap-4">
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium">{t("Machine")}</label>
                  <MachineSelect
                    value={selectedMachineName}
                    onChange={(v) => {
                      setSelectedMachineName(v);
                      reportSearch.reset();
                      setPartLookup(null);
                    }}
                    machineNames={machineNames}
                    t={t}
                  />
                </div>

                <div className="grid gap-1.5">
                  <label className="text-sm font-medium">{t("Part Name")}</label>
                  <PartSearchCombobox
                    search={reportSearch}
                    onChange={(v) => {
                      reportSearch.setQuery(v);
                      setPartLookup(null);
                    }}
                    onSelect={selectReportSuggestion}
                    onBlur={handlePartNameBlur}
                    placeholder={
                      selectedMachineName ? t("Type a part number or description…") : t("Type a part number or name…")
                    }
                    t={t}
                  />
                  <PartLookupBanner lookup={partLookup} loading={partLookupLoading} t={t} />
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

                <Button type="submit" disabled={submitting || !reportSearch.query.trim()}>
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

          <Card
            aria-hidden={tab !== "stock"}
            className={cn("col-start-1 row-start-1", tab !== "stock" && "invisible")}
          >
            <CardHeader>
              <CardTitle>{t("Add / Update Stock")}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleStockSubmit} className="grid gap-4">
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium">{t("Machine")}</label>
                  <MachineSelect
                    value={stockMachineName}
                    onChange={(v) => {
                      setStockMachineName(v);
                      stockSearch.reset();
                      setStockPartLookup(null);
                    }}
                    machineNames={machineNames}
                    t={t}
                  />
                </div>

                <div className="grid gap-1.5">
                  <label className="text-sm font-medium">{t("Part Number")}</label>
                  <PartSearchCombobox
                    search={stockSearch}
                    onChange={(v) => {
                      stockSearch.setQuery(v);
                      setStockPartLookup(null);
                    }}
                    onSelect={selectStockSuggestion}
                    onBlur={handleStockPartBlur}
                    placeholder={
                      stockMachineName ? t("Type a part number or description…") : t("Type a part number or name…")
                    }
                    t={t}
                  />
                  <PartLookupBanner lookup={stockPartLookup} loading={stockPartLookupLoading} t={t} />
                </div>

                <div className="grid gap-1.5">
                  <label className="text-sm font-medium">{t("Description")}</label>
                  <Input value={stockDescription} onChange={(e) => setStockDescription(e.target.value)} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-1.5">
                    <label className="text-sm font-medium">{t("Quantity")}</label>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={stockQty}
                      onChange={(e) => setStockQty(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-sm font-medium">{t("Note")}</label>
                    <Input value={stockNote} onChange={(e) => setStockNote(e.target.value)} />
                  </div>
                </div>

                <Button type="submit" disabled={stockSubmitting || !stockSearch.query.trim()}>
                  {stockSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("Submitting")}
                    </>
                  ) : (
                    t("Save")
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

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
          <Button
            type="button"
            size="sm"
            variant={tab === "stock" ? "default" : "ghost"}
            className="h-7"
            onClick={() => setTab("stock")}
          >
            {t("Stock")} {stock.length}
          </Button>
        </div>

        {tab === "stock" ? (
          <>
            {loading ? (
              <p className="text-muted-foreground text-sm">…</p>
            ) : stock.length === 0 ? (
              <p className="text-muted-foreground text-sm italic">{t("No stock recorded yet.")}</p>
            ) : (
              <div className="overflow-hidden rounded-lg border bg-card">
                <Table className="min-w-[820px]">
                  <TableHeader className="bg-muted/60">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="px-3">{t("Part Number")}</TableHead>
                      <TableHead className="px-3">{t("Description")}</TableHead>
                      <TableHead className="px-3">{t("Machine")}</TableHead>
                      <TableHead className="px-3 text-right">{t("Quantity")}</TableHead>
                      <TableHead className="px-3">{t("Note")}</TableHead>
                      <TableHead className="px-3">{t("Updated")}</TableHead>
                      <TableHead className="px-3 text-right">{t("Actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stock.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="px-3 font-mono text-xs font-medium">{item.partNo}</TableCell>
                        <TableCell className="max-w-[240px] whitespace-normal px-3 text-sm">
                          {item.description || <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell className="px-3">{item.machineName || t("(none)")}</TableCell>
                        <TableCell className="px-3 text-right font-mono text-sm tabular-nums">{item.qty}</TableCell>
                        <TableCell className="max-w-[200px] whitespace-normal px-3 text-sm">
                          {item.note || <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell className="px-3 text-xs text-muted-foreground">
                          {new Date(item.updatedAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="px-3">
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              size="icon-xs"
                              variant="ghost"
                              aria-label={t("Edit")}
                              title={t("Edit")}
                              onClick={() => editStockItem(item)}
                            >
                              <Pencil />
                            </Button>
                            <Button
                              type="button"
                              size="icon-xs"
                              variant="ghost"
                              aria-label={t("Delete")}
                              title={t("Delete")}
                              onClick={() => handleDeleteStock(item.id)}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        ) : loading ? (
          <p className="text-muted-foreground text-sm">…</p>
        ) : visibleLogs.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">{t("No records.")}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            <Table className="min-w-[760px]">
              <TableHeader className="bg-muted/60">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-3">{t("Status")}</TableHead>
                  <TableHead className="px-3">{t("Part Name")}</TableHead>
                  <TableHead className="px-3">{t("Machine")}</TableHead>
                  <TableHead className="px-3">{t("Details")}</TableHead>
                  <TableHead className="px-3">{t("Reported")}</TableHead>
                  <TableHead className="px-3">{t("Date")}</TableHead>
                  {tab === "active" && <TableHead className="min-w-[220px] px-3">{t("Actions")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="px-3 font-medium">{t(log.status)}</TableCell>
                    <TableCell className="px-3 font-medium">{log.partName}</TableCell>
                    <TableCell className="px-3">{log.machineName || t("(none)")}</TableCell>
                    <TableCell className="px-3 text-sm">
                      {log.isLoan && log.borrower ? (
                        <span>{t("Borrower")}: {log.borrower}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="px-3">{log.reporterEmployeeId || "-"}</TableCell>
                    <TableCell className="px-3 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleDateString()}
                    </TableCell>
                    {tab === "active" && (
                      <TableCell className="px-3">
                        <StatusAction
                          log={log}
                          updating={updatingId === log.id}
                          onUpdate={handleStatusUpdate}
                          t={t}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
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
