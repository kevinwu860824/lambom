"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  addStorageLocation,
  createLog,
  deleteStorageLocation,
  deleteStockItem,
  fetchLogs,
  fetchStock,
  fetchStorageLocations,
  renameStorageLocation,
  updateLogStatus,
  upsertStockItem,
  type InventoryLog,
  type InventoryStorageLocation,
  type StockItem,
} from "@/lib/inventory";
import { useEmployeeGroup } from "@/lib/groups";
import { useTranslate } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RequireGroupPrompt } from "@/components/require-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LanguageSwitcher } from "@/components/language-switcher";

const zh: Record<string, string> = {
  "Spare Parts Inventory": "備品庫存管理",
  "Report missing/loaned parts and track them through to completion — records are shared within your active group.":
    "回報缺料或借出零件並追蹤結案——紀錄只會在目前群組內共用。",
  "Back to Internal Tools": "回內部工具首頁",
  Machine: "機台",
  "Select machine": "選擇機台",
  "(none)": "(不選)",
  "Part Name": "零件名稱",
  "Description": "說明",
  "Quantity": "數量",
  "Note": "備註",
  "Type a part number or description…": "輸入料號或說明…",
  "Type a part number or name…": "輸入料號或零件名稱…",
  "+{count} more match — type more to narrow down": "還有 {count} 筆相符,請輸入更多字元縮小範圍",
  "Matched in {count} machines": "符合 {count} 台機台",
  "Found in Full BOM": "在完整 BOM 表中找到",
  "Found in this group's Full BOM": "在目前群組的完整 BOM 表中找到",
  "Not found in this machine's Full BOM — double-check the part number.": "在這台機台的完整 BOM 表中找不到——請再次確認料號是否正確。",
  "Not found in this group's Full BOM — double-check the part number.": "在目前群組的完整 BOM 表中找不到——請再次確認料號是否正確。",
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
  Order: "下訂",
  Received: "到貨",
  "Picked up": "領取",
  Complete: "結案",
  Return: "歸還",
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
  IAM: "IAM",
  "Storage Location": "存放地點",
  "Select storage location": "選擇存放地點",
  "Edit storage locations": "編輯存放地點",
  "Manage storage locations": "管理存放地點",
  "Storage locations are managed for your active group.": "存放地點選項依目前群組分開管理。",
  "Add a location": "新增存放地點",
  "Add location": "新增地點",
  "Save location": "儲存地點",
  "Delete location": "刪除地點",
  "No storage locations yet.": "尚未設定存放地點。",
  "Storage location is in use and cannot be deleted.": "此存放地點仍有紀錄使用，無法刪除。",
  "Delete this storage location?": "確定刪除此存放地點？",
  Close: "關閉",
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
const NONE_LOCATION_VALUE = "__none_location__";
const EDIT_STORAGE_LOCATIONS_VALUE = "__edit_storage_locations__";

type SupabaseClient = ReturnType<typeof createClient>;

/** Debounced autocomplete against one machine or the active group's Full BOMs. */
function usePartSearch(getSupabase: () => SupabaseClient, machineName: string, groupMachineNames: string[]) {
  const searchMachineNames = useMemo(
    () => (machineName ? (groupMachineNames.includes(machineName) ? [machineName] : []) : groupMachineNames),
    [machineName, groupMachineNames]
  );
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const [suggestions, setSuggestions] = useState<Awaited<ReturnType<typeof searchFullBomItems>>["items"]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const trimmed = debounced.trim();
  const eligible = searchMachineNames.length > 0 && trimmed.length >= 2;
  // Derived at render time rather than reset via a synchronous setState in
  // the effect below — once the query no longer qualifies for a search,
  // the last-fetched suggestions are simply not shown.
  const visible = eligible ? suggestions : [];
  const truncatedCount = eligible ? Math.max(0, total - suggestions.length) : 0;

  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    searchFullBomItems(getSupabase(), searchMachineNames, trimmed)
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
  }, [eligible, getSupabase, searchMachineNames, trimmed]);

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
  showMachineCount,
  t,
}: {
  search: PartSearchState;
  onChange: (value: string) => void;
  onSelect: (item: BomItem) => void;
  onBlur?: () => void;
  placeholder: string;
  showMachineCount: boolean;
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
              {showMachineCount && (
                <div className="mt-0.5 text-muted-foreground text-[11px]">
                  {t("Matched in {count} machines").replace("{count}", String(item.machineCount))}
                </div>
              )}
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

function StorageLocationField({
  value,
  locations,
  onChange,
  onEdit,
  t,
}: {
  value: number | null;
  locations: InventoryStorageLocation[];
  onChange: (value: number | null) => void;
  onEdit: () => void;
  t: (text: string) => string;
}) {
  return (
    <div className="grid gap-1.5">
      <label className="text-sm font-medium">{t("Storage Location")}</label>
      <Select
        value={value == null ? NONE_LOCATION_VALUE : String(value)}
        onValueChange={(selected) => {
          if (selected === EDIT_STORAGE_LOCATIONS_VALUE) {
            onEdit();
            return;
          }
          onChange(selected === NONE_LOCATION_VALUE ? null : Number(selected));
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t("Select storage location")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_LOCATION_VALUE}>{t("(none)")}</SelectItem>
          {locations.map((location) => (
            <SelectItem key={location.id} value={String(location.id)}>
              {location.name}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={EDIT_STORAGE_LOCATIONS_VALUE} className="text-primary">
            <Pencil />
            {t("Edit storage locations")}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

/** Shows whether a part was found in the selected machine or active group. */
function PartLookupBanner({
  lookup,
  loading,
  machineName,
  t,
}: {
  lookup: { item: (BomItem & { machineCount?: number }) | null } | null;
  loading: boolean;
  machineName: string;
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
                <p className="font-medium">
                  {t(machineName ? "Found in Full BOM" : "Found in this group's Full BOM")}
                </p>
                <p>{lookup.item.description}</p>
                {machineName ? (
                  <p>
                    {t("Qty")} {lookup.item.qty ?? "-"} · {t("Unit")} {lookup.item.uom ?? "-"}
                  </p>
                ) : lookup.item.machineCount ? (
                  <p>{t("Matched in {count} machines").replace("{count}", String(lookup.item.machineCount))}</p>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <CircleAlert className="h-3.5 w-3.5 shrink-0" />
              <p>
                {t(
                  machineName
                    ? "Not found in this machine's Full BOM — double-check the part number."
                    : "Not found in this group's Full BOM — double-check the part number."
                )}
              </p>
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
  const getSupabase = useCallback(() => {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }, []);

  const { employeeId, group, allowedMachines, notFound, loading: groupLoading } = useEmployeeGroup();
  const machineNames = useMemo(() => Array.from(allowedMachines ?? []).sort(), [allowedMachines]);

  const [logs, setLogs] = useState<InventoryLog[]>([]);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [storageLocations, setStorageLocations] = useState<InventoryStorageLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "archive" | "stock">("active");
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  // Report form state
  const [selectedMachineName, setSelectedMachineName] = useState("");
  const [reportDescription, setReportDescription] = useState("");
  const [reportQty, setReportQty] = useState("1");
  const [reportNote, setReportNote] = useState("");
  const [isLoan, setIsLoan] = useState(false);
  const [borrower, setBorrower] = useState("");
  const [reportIam, setReportIam] = useState("");
  const [reportStorageLocationId, setReportStorageLocationId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [storageLocationDialogOpen, setStorageLocationDialogOpen] = useState(false);
  const [newStorageLocationName, setNewStorageLocationName] = useState("");
  const [storageLocationDrafts, setStorageLocationDrafts] = useState<Record<number, string>>({});
  const [storageLocationError, setStorageLocationError] = useState<string | null>(null);
  const [savingStorageLocationId, setSavingStorageLocationId] = useState<number | null>(null);

  const reportSearch = usePartSearch(getSupabase, selectedMachineName, machineNames);

  // Whatever the Full BOM lookup last found (or didn't) for the exact text
  // currently in the part name field — set either by clicking a
  // suggestion directly (already known), or on blur for whatever was
  // typed without picking one. Cleared whenever the machine/part text
  // changes, so a stale result never lingers past the input it described.
  const [partLookup, setPartLookup] = useState<{ item: (BomItem & { machineCount?: number }) | null } | null>(null);
  const [partLookupLoading, setPartLookupLoading] = useState(false);

  async function findPartMatch(machineName: string, partNo: string): Promise<BomItem & { machineCount?: number } | null> {
    if (machineName) return fetchFullBomItemByPartNo(getSupabase(), machineName, partNo);
    const result = await searchFullBomItems(getSupabase(), machineNames, partNo);
    return result.items.find((item) => item.part_no.toLowerCase() === partNo.toLowerCase()) ?? null;
  }

  async function handlePartNameBlur() {
    reportSearch.setOpen(false);
    const trimmed = reportSearch.query.trim();
    if (!trimmed) return;
    setPartLookupLoading(true);
    try {
      const item = await findPartMatch(selectedMachineName, trimmed);
      setPartLookup({ item });
      if (item?.description) setReportDescription((current) => current.trim() || item.description || "");
    } catch {
      // Best-effort — a failed lookup shouldn't block filling out the form.
      setPartLookup(null);
    } finally {
      setPartLookupLoading(false);
    }
  }

  function selectReportSuggestion(item: BomItem & { machineCount?: number }) {
    reportSearch.setQuery(item.part_no);
    setPartLookup({ item });
    setReportDescription(item.description ?? "");
    reportSearch.setOpen(false);
  }

  // Stock form state — mirrors the Report form exactly: a machine picker
  // (optional, defaults to none) drives the same Full BOM search/
  // suggestions/found-banner, and the chosen machine is saved on the row
  // as which machine this stock entry was requested because of.
  const [stockMachineName, setStockMachineName] = useState("");
  const stockSearch = usePartSearch(getSupabase, stockMachineName, machineNames);
  const [stockPartLookup, setStockPartLookup] = useState<{ item: (BomItem & { machineCount?: number }) | null } | null>(null);
  const [stockPartLookupLoading, setStockPartLookupLoading] = useState(false);
  const [stockIam, setStockIam] = useState("");
  const [stockStorageLocationId, setStockStorageLocationId] = useState<number | null>(null);
  const [stockDescription, setStockDescription] = useState("");
  const [stockQty, setStockQty] = useState("1");
  const [stockNote, setStockNote] = useState("");
  const [stockSubmitting, setStockSubmitting] = useState(false);

  async function handleStockPartBlur() {
    stockSearch.setOpen(false);
    const trimmed = stockSearch.query.trim();
    if (!trimmed) return;
    setStockPartLookupLoading(true);
    try {
      const item = await findPartMatch(stockMachineName, trimmed);
      setStockPartLookup({ item });
    } catch {
      setStockPartLookup(null);
    } finally {
      setStockPartLookupLoading(false);
    }
  }

  function selectStockSuggestion(item: BomItem & { machineCount?: number }) {
    stockSearch.setQuery(item.part_no);
    setStockDescription(item.description ?? "");
    setStockPartLookup({ item });
    stockSearch.setOpen(false);
  }

  function editStockItem(item: StockItem) {
    setStockMachineName(item.machineName);
    stockSearch.setQuery(item.partNo);
    setStockPartLookup(null);
    setStockIam(item.iam ?? "");
    setStockStorageLocationId(item.storageLocationId);
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
        iam: stockIam.trim() || null,
        storageLocationId: stockStorageLocationId,
        description: stockDescription.trim() || null,
        qty: Math.max(0, Math.round(Number(stockQty) || 0)),
        note: stockNote.trim() || null,
      });
      setStockMachineName("");
      setStockIam("");
      setStockStorageLocationId(null);
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

  async function handleAddStorageLocation() {
    if (!group) return;
    const name = newStorageLocationName.trim();
    if (!name) return;
    setStorageLocationError(null);
    try {
      await addStorageLocation(getSupabase(), group.id, name);
      setNewStorageLocationName("");
      await loadAll();
    } catch (err) {
      setStorageLocationError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRenameStorageLocation(id: number) {
    if (!group) return;
    const name = (storageLocationDrafts[id] ?? "").trim();
    if (!name) return;
    setStorageLocationError(null);
    setSavingStorageLocationId(id);
    try {
      await renameStorageLocation(getSupabase(), group.id, id, name);
      await loadAll();
    } catch (err) {
      setStorageLocationError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingStorageLocationId(null);
    }
  }

  async function handleDeleteStorageLocation(id: number) {
    if (!group || !window.confirm(t("Delete this storage location?"))) return;
    setStorageLocationError(null);
    try {
      await deleteStorageLocation(getSupabase(), group.id, id);
      await loadAll();
    } catch {
      setStorageLocationError(t("Storage location is in use and cannot be deleted."));
    }
  }

  async function loadAll() {
    const groupId = group?.id;
    if (groupId == null) {
      setLogs([]);
      setStock([]);
      setStorageLocations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [logsData, stockData, locationsData] = await Promise.all([
        fetchLogs(getSupabase(), groupId),
        fetchStock(getSupabase(), groupId),
        fetchStorageLocations(getSupabase(), groupId),
      ]);
      setLogs(logsData);
      setStock(stockData);
      setStorageLocations(locationsData);
      setStorageLocationDrafts(Object.fromEntries(locationsData.map((location) => [location.id, location.name])));
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

  const storageLocationNames = useMemo(
    () => new Map(storageLocations.map((location) => [location.id, location.name])),
    [storageLocations]
  );

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
        description: reportDescription.trim() || null,
        qty: Math.max(1, Math.round(Number(reportQty) || 1)),
        note: reportNote.trim() || null,
        iam: reportIam.trim() || null,
        storageLocationId: reportStorageLocationId,
        isLoan,
        borrower: isLoan ? borrower.trim() || null : null,
        reporterEmployeeId: employeeId,
      });
      setMessage(isLoan ? t("Loan recorded.") : t("Part reported."));
      setSelectedMachineName("");
      reportSearch.reset();
      setPartLookup(null);
      setReportDescription("");
      setReportQty("1");
      setReportNote("");
      setIsLoan(false);
      setBorrower("");
      setReportIam("");
      setReportStorageLocationId(null);
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
              <CardTitle>{t("Add / Update Stock")}</CardTitle>
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
                  <label className="text-sm font-medium">{t("IAM")}</label>
                  <Input value={reportIam} onChange={(event) => setReportIam(event.target.value)} />
                </div>

                <StorageLocationField
                  value={reportStorageLocationId}
                  locations={storageLocations}
                  onChange={setReportStorageLocationId}
                  onEdit={() => {
                    setStorageLocationError(null);
                    setStorageLocationDialogOpen(true);
                  }}
                  t={t}
                />

                <div className="grid gap-1.5">
                  <label className="text-sm font-medium">{t("Part Name")}</label>
                  <PartSearchCombobox
                    search={reportSearch}
                    onChange={(v) => {
                      reportSearch.setQuery(v);
                      setPartLookup(null);
                      setReportDescription("");
                    }}
                    onSelect={selectReportSuggestion}
                    onBlur={handlePartNameBlur}
                    showMachineCount={!selectedMachineName}
                    placeholder={
                      selectedMachineName ? t("Type a part number or description…") : t("Type a part number or name…")
                    }
                    t={t}
                  />
                  <PartLookupBanner
                    lookup={partLookup}
                    loading={partLookupLoading}
                    machineName={selectedMachineName}
                    t={t}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="grid gap-1.5 sm:col-span-1">
                    <label className="text-sm font-medium">{t("Description")}</label>
                    <Input value={reportDescription} onChange={(event) => setReportDescription(event.target.value)} />
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-sm font-medium">{t("Quantity")}</label>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={reportQty}
                      onChange={(event) => setReportQty(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-sm font-medium">{t("Note")}</label>
                    <Input value={reportNote} onChange={(event) => setReportNote(event.target.value)} />
                  </div>
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
                  <label className="text-sm font-medium">{t("IAM")}</label>
                  <Input value={stockIam} onChange={(event) => setStockIam(event.target.value)} />
                </div>

                <StorageLocationField
                  value={stockStorageLocationId}
                  locations={storageLocations}
                  onChange={setStockStorageLocationId}
                  onEdit={() => {
                    setStorageLocationError(null);
                    setStorageLocationDialogOpen(true);
                  }}
                  t={t}
                />

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
                    showMachineCount={!stockMachineName}
                    placeholder={
                      stockMachineName ? t("Type a part number or description…") : t("Type a part number or name…")
                    }
                    t={t}
                  />
                  <PartLookupBanner
                    lookup={stockPartLookup}
                    loading={stockPartLookupLoading}
                    machineName={stockMachineName}
                    t={t}
                  />
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
                <Table className="min-w-[1000px]">
                  <TableHeader className="bg-muted/60">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="px-3">{t("Part Number")}</TableHead>
                      <TableHead className="px-3">{t("Description")}</TableHead>
                      <TableHead className="px-3">{t("Machine")}</TableHead>
                      <TableHead className="px-3">{t("IAM")}</TableHead>
                      <TableHead className="px-3">{t("Storage Location")}</TableHead>
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
                        <TableCell className="px-3">{item.iam || "-"}</TableCell>
                        <TableCell className="px-3">
                          {item.storageLocationId == null ? "-" : storageLocationNames.get(item.storageLocationId) ?? "-"}
                        </TableCell>
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
            <Table className="min-w-[1000px]">
              <TableHeader className="bg-muted/60">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-3">{t("Status")}</TableHead>
                  <TableHead className="px-3">{t("Part Name")}</TableHead>
                  <TableHead className="px-3">{t("Description")}</TableHead>
                  <TableHead className="px-3 text-right">{t("Quantity")}</TableHead>
                  <TableHead className="px-3">{t("Note")}</TableHead>
                  <TableHead className="px-3">{t("Machine")}</TableHead>
                  <TableHead className="px-3">{t("Details")}</TableHead>
                  <TableHead className="px-3">{t("IAM")}</TableHead>
                  <TableHead className="px-3">{t("Storage Location")}</TableHead>
                  <TableHead className="px-3">{t("Reported")}</TableHead>
                  <TableHead className="px-3">{t("Date")}</TableHead>
                  {tab === "active" && <TableHead className="px-3">{t("Actions")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="px-3 font-medium">{t(log.status)}</TableCell>
                    <TableCell className="px-3 font-medium">{log.partName}</TableCell>
                    <TableCell className="max-w-[220px] whitespace-normal px-3">
                      {log.description || <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell className="px-3 text-right font-mono tabular-nums">{log.qty}</TableCell>
                    <TableCell className="max-w-[200px] whitespace-normal px-3">
                      {log.note || <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell className="px-3">{log.machineName || t("(none)")}</TableCell>
                    <TableCell className="px-3 text-sm">
                      {log.isLoan && log.borrower ? (
                        <span>{t("Borrower")}: {log.borrower}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="px-3">{log.iam || "-"}</TableCell>
                    <TableCell className="px-3">
                      {log.storageLocationId == null ? "-" : storageLocationNames.get(log.storageLocationId) ?? "-"}
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

        <Dialog
          open={storageLocationDialogOpen}
          onOpenChange={(open) => {
            setStorageLocationDialogOpen(open);
            if (!open) setStorageLocationError(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("Manage storage locations")}</DialogTitle>
              <DialogDescription>{t("Storage locations are managed for your active group.")}</DialogDescription>
            </DialogHeader>

            <div className="flex gap-2">
              <Input
                value={newStorageLocationName}
                onChange={(event) => setNewStorageLocationName(event.target.value)}
                placeholder={t("Add a location")}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleAddStorageLocation();
                  }
                }}
              />
              <Button type="button" onClick={handleAddStorageLocation} disabled={!newStorageLocationName.trim()}>
                {t("Add location")}
              </Button>
            </div>

            {storageLocationError && <p className="text-destructive text-sm">{storageLocationError}</p>}

            <div className="grid max-h-64 gap-2 overflow-y-auto">
              {storageLocations.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("No storage locations yet.")}</p>
              ) : (
                storageLocations.map((location) => (
                  <div key={location.id} className="flex items-center gap-2">
                    <Input
                      value={storageLocationDrafts[location.id] ?? location.name}
                      onChange={(event) =>
                        setStorageLocationDrafts((previous) => ({
                          ...previous,
                          [location.id]: event.target.value,
                        }))
                      }
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={savingStorageLocationId === location.id || !(storageLocationDrafts[location.id] ?? location.name).trim()}
                      onClick={() => handleRenameStorageLocation(location.id)}
                    >
                      {savingStorageLocationId === location.id ? t("Submitting") : t("Save location")}
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("Delete location")}
                      title={t("Delete location")}
                      onClick={() => handleDeleteStorageLocation(location.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStorageLocationDialogOpen(false)}>
                {t("Close")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
        <Button size="sm" className="whitespace-nowrap px-2.5" disabled={updating} onClick={() => onUpdate(log, "ordered")}>
          {icon ?? <ShoppingCart className="h-4 w-4" />} {t("Order")}
        </Button>
      );
    case "ordered":
      return (
        <Button size="sm" className="whitespace-nowrap px-2.5" disabled={updating} onClick={() => onUpdate(log, "arrived")}>
          {icon ?? <Truck className="h-4 w-4" />} {t("Received")}
        </Button>
      );
    case "arrived":
      return (
        <Button size="sm" className="whitespace-nowrap px-2.5" disabled={updating} onClick={() => onUpdate(log, "picked_up")}>
          {icon ?? <PackageCheck className="h-4 w-4" />} {t("Picked up")}
        </Button>
      );
    case "picked_up":
      return (
        <Button size="sm" className="whitespace-nowrap px-2.5" disabled={updating} onClick={() => onUpdate(log, "completed")}>
          {icon ?? <PackageCheck className="h-4 w-4" />} {t("Complete")}
        </Button>
      );
    case "loaned":
      return (
        <Button size="sm" className="whitespace-nowrap px-2.5" disabled={updating} onClick={() => onUpdate(log, "returned")}>
          {icon ?? <RotateCcw className="h-4 w-4" />} {t("Return")}
        </Button>
      );
    default:
      return <p className="text-muted-foreground text-center text-xs">{t("Waiting on the next step…")}</p>;
  }
}
