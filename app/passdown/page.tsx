"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Clipboard, ClipboardCheck, Plus, Settings } from "lucide-react";
import { createClient } from "@/lib/supabase";
import {
  addUpdate,
  fetchEntriesForDate,
  fetchEntriesHistory,
  fetchKnownMachines,
  fetchLatestEntryDateBefore,
  fetchPeople,
  fetchUpdatesForEntries,
  SHIFT_LABELS,
  STATUS_LABELS,
  upsertEntry,
  type KnownMachine,
  type PassdownEntry,
  type PassdownPerson,
  type PassdownShift,
  type PassdownStatus,
  type PassdownUpdate,
} from "@/lib/passdown";
import { PassdownEntryRow } from "@/components/passdown-entry-row";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type BoardEntry = PassdownEntry & { isPlaceholder?: boolean };

function machineKey(e: { toolId: string; module: string }): string {
  return `${e.toolId}|${e.module}`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildEmailText(date: string, entries: PassdownEntry[], updates: Map<number, PassdownUpdate[]>): string {
  const lines = [`F22 VXT Passdown — ${date}`, ""];
  const byTool = new Map<string, PassdownEntry[]>();
  for (const e of entries) {
    if (!byTool.has(e.toolId)) byTool.set(e.toolId, []);
    byTool.get(e.toolId)!.push(e);
  }
  for (const [toolId, list] of [...byTool.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`【${toolId}】`);
    for (const e of list) {
      lines.push(`  ${e.module} - ${STATUS_LABELS[e.status]}${e.product ? ` (${e.product})` : ""}`);
      if (e.problemStatement) lines.push(`    Problem: ${e.problemStatement}`);
      if (e.remark) lines.push(`    Remark: ${e.remark}`);
      for (const u of updates.get(e.id) ?? []) {
        const shift = u.shift ? `${SHIFT_LABELS[u.shift]} ` : "";
        lines.push(`    - [${shift}${u.personName ?? "?"}] ${u.note}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function buildEmailHtml(date: string, entries: PassdownEntry[], updates: Map<number, PassdownUpdate[]>): string {
  const byTool = new Map<string, PassdownEntry[]>();
  for (const e of entries) {
    if (!byTool.has(e.toolId)) byTool.set(e.toolId, []);
    byTool.get(e.toolId)!.push(e);
  }
  const rows = [...byTool.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .flatMap(([toolId, list]) =>
      list.map((e, i) => {
        const notes = (updates.get(e.id) ?? [])
          .map((u) => `<div>- [${u.shift ? SHIFT_LABELS[u.shift] + " " : ""}${u.personName ?? "?"}] ${u.note}</div>`)
          .join("");
        return `<tr>
          <td style="border:1px solid #ccc;padding:4px 8px;">${i === 0 ? toolId : ""}</td>
          <td style="border:1px solid #ccc;padding:4px 8px;">${e.module}</td>
          <td style="border:1px solid #ccc;padding:4px 8px;">${STATUS_LABELS[e.status]}</td>
          <td style="border:1px solid #ccc;padding:4px 8px;">${e.problemStatement ?? ""}</td>
          <td style="border:1px solid #ccc;padding:4px 8px;">${e.remark ?? ""}${notes}</td>
        </tr>`;
      })
    )
    .join("");
  return `<div><b>F22 VXT Passdown — ${date}</b></div>
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:13px;margin-top:8px;">
      <thead><tr>
        <th style="border:1px solid #ccc;padding:4px 8px;text-align:left;">Tool</th>
        <th style="border:1px solid #ccc;padding:4px 8px;text-align:left;">Module</th>
        <th style="border:1px solid #ccc;padding:4px 8px;text-align:left;">Status</th>
        <th style="border:1px solid #ccc;padding:4px 8px;text-align:left;">Problem</th>
        <th style="border:1px solid #ccc;padding:4px 8px;text-align:left;">Remark / Notes</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

const CUSTOM_MACHINE_KEY = "__custom__";

function NewEntryDialog({
  open,
  onOpenChange,
  onCreate,
  knownMachines,
  excludeKeys,
  existingKeys,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: {
    toolId: string;
    product: string;
    module: string;
    status: PassdownStatus;
    problemStatement: string;
  }) => Promise<void>;
  knownMachines: KnownMachine[];
  /** Machines currently visible on the board — hidden from the picker since
   * there's nothing to "bring back". */
  excludeKeys: Set<string>;
  /** Machines that already have a row today (visible or hidden). Picking one
   * of these just reveals it — the Status/Problem fields below are ignored
   * so a hidden Up machine's real data never gets clobbered by whatever's
   * sitting in this form. */
  existingKeys: Set<string>;
}) {
  const [selectedKey, setSelectedKey] = useState("");
  const [toolId, setToolId] = useState("");
  const [product, setProduct] = useState("");
  const [module, setModule] = useState("");
  const [status, setStatus] = useState<PassdownStatus>("other");
  const [problemStatement, setProblemStatement] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableMachines = knownMachines.filter((m) => !excludeKeys.has(machineKey(m)));
  const isCustom = selectedKey === CUSTOM_MACHINE_KEY;
  const isExistingHidden = selectedKey !== "" && !isCustom && existingKeys.has(selectedKey);

  function handleSelectMachine(key: string) {
    setSelectedKey(key);
    if (key === CUSTOM_MACHINE_KEY) {
      setToolId("");
      setProduct("");
      setModule("");
      return;
    }
    const m = availableMachines.find((m) => machineKey(m) === key);
    if (m) {
      setToolId(m.toolId);
      setModule(m.module);
      setProduct(m.product ?? "");
    }
  }

  function reset() {
    setSelectedKey("");
    setToolId("");
    setProduct("");
    setModule("");
    setStatus("other");
    setProblemStatement("");
  }

  async function handleSubmit() {
    if (!toolId.trim() || !module.trim()) {
      setError("請選擇機台,或選「其他」手動輸入 Tool ID / Module");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        toolId: toolId.trim().toUpperCase(),
        product: product.trim(),
        module: module.trim(),
        status,
        problemStatement: problemStatement.trim(),
      });
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新增機台</DialogTitle>
          <DialogDescription>選擇要加進今天看板的機台/Module。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="mb-1">機台</Label>
            <Select value={selectedKey} onValueChange={handleSelectMachine}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="選擇機台..." />
              </SelectTrigger>
              <SelectContent>
                {availableMachines.map((m) => (
                  <SelectItem key={machineKey(m)} value={machineKey(m)}>
                    {m.toolId} - {m.module}
                    {m.product ? ` (${m.product})` : ""}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_MACHINE_KEY}>其他(手動輸入新機台)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isCustom && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1">Tool ID</Label>
                <Input value={toolId} onChange={(e) => setToolId(e.target.value)} placeholder="CCTEN1" />
              </div>
              <div>
                <Label className="mb-1">Module</Label>
                <Input value={module} onChange={(e) => setModule(e.target.value)} placeholder="PM1" />
              </div>
            </div>
          )}
          {isCustom && (
            <div>
              <Label className="mb-1">Product</Label>
              <Input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="TEOS" />
            </div>
          )}
          {isExistingHidden ? (
            <p className="text-muted-foreground text-sm">
              這台今天已經有記錄(狀態是 Up 所以被隱藏),選「顯示」會直接把它叫出來,不會更動它原本的資料。
            </p>
          ) : (
            <>
              <div>
                <Label className="mb-1">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as PassdownStatus)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["up", "down", "monitor", "other"] as PassdownStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1">Problem Statement</Label>
                <Input value={problemStatement} onChange={(e) => setProblemStatement(e.target.value)} />
              </div>
            </>
          )}
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving || !toolId.trim() || !module.trim()}>
            {saving ? "處理中..." : isExistingHidden ? "顯示" : "建立"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PassdownPage() {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  const [view, setView] = useState<"board" | "history">("board");
  const [date, setDate] = useState(todayStr());
  const [entries, setEntries] = useState<BoardEntry[]>([]);
  const [updatesByEntry, setUpdatesByEntry] = useState<Map<number, PassdownUpdate[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Machines explicitly pulled back onto the board via "+新增機台" even
  // though their status is Up — reset whenever the viewed date changes (see
  // loadBoard below).
  const [forcedVisibleKeys, setForcedVisibleKeys] = useState<Set<string>>(new Set());
  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const [people, setPeople] = useState<PassdownPerson[]>([]);
  const [meId, setMeId] = useState<string>("");
  const [shift, setShift] = useState<PassdownShift>("day");
  const [knownMachines, setKnownMachines] = useState<KnownMachine[]>([]);

  const [historyFrom, setHistoryFrom] = useState(addDays(todayStr(), -7));
  const [historyTo, setHistoryTo] = useState(todayStr());
  const [historyToolId, setHistoryToolId] = useState("");
  const [historyResults, setHistoryResults] = useState<PassdownEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historySearched, setHistorySearched] = useState(false);

  useEffect(() => {
    fetchPeople(getSupabase())
      .then(setPeople)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    fetchKnownMachines(getSupabase())
      .then(setKnownMachines)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    const savedMe = localStorage.getItem("passdown_me");
    if (savedMe) setMeId(savedMe);
    const savedShift = localStorage.getItem("passdown_shift");
    if (savedShift === "day" || savedShift === "night") setShift(savedShift);
  }, []);

  // Seeds the day's board from whatever machines were already being tracked
  // as of the most recent earlier date with data, instead of starting blank
  // every day — carried-forward rows are flagged isPlaceholder and only
  // become real passdown_entries rows once someone edits them (see
  // handleStatusChange/handleFieldSave/handleAddNote below).
  const fetchBoardData = useCallback(async (d: string) => {
    const supabase = getSupabase();
    const todayEntries = await fetchEntriesForDate(supabase, d);
    const todayKeys = new Set(todayEntries.map(machineKey));

    const prevDate = await fetchLatestEntryDateBefore(supabase, d);
    const prevEntries = prevDate ? await fetchEntriesForDate(supabase, prevDate) : [];

    const board: BoardEntry[] = [...todayEntries];
    for (const p of prevEntries) {
      if (todayKeys.has(machineKey(p))) continue;
      board.push({
        ...p,
        entryDate: d,
        updatedById: null,
        updatedByName: null,
        isPlaceholder: true,
      });
    }

    const updates = await fetchUpdatesForEntries(
      supabase,
      todayEntries.map((e) => e.id)
    );
    const map = new Map<number, PassdownUpdate[]>();
    for (const u of updates) {
      if (!map.has(u.entryId)) map.set(u.entryId, []);
      map.get(u.entryId)!.push(u);
    }
    return { board, updatesMap: map };
  }, []);

  const loadBoard = useCallback(
    async (d: string) => {
      setLoading(true);
      setError(null);
      setForcedVisibleKeys(new Set());
      try {
        const { board, updatesMap } = await fetchBoardData(d);
        setEntries(board);
        setUpdatesByEntry(updatesMap);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [fetchBoardData]
  );

  // Same fetch as loadBoard, but doesn't touch the loading flag — used for
  // realtime-triggered refreshes (including the echo of our own edits) so
  // the table quietly re-syncs instead of flashing to a "載入中" screen on
  // every status change or note.
  const refreshBoardSilently = useCallback(
    async (d: string) => {
      try {
        const { board, updatesMap } = await fetchBoardData(d);
        setEntries(board);
        setUpdatesByEntry(updatesMap);
      } catch {
        // Best-effort background refresh; a real problem will surface on the
        // next explicit load (date change) instead of interrupting editing.
      }
    },
    [fetchBoardData]
  );

  useEffect(() => {
    loadBoard(date);
  }, [date, loadBoard]);

  // Live-updates the board when a teammate adds/edits an entry or note for
  // the same day, so "did someone already touch this?" is answered by
  // watching the screen instead of hoping nobody collides — refetching the
  // whole (small, ~45-row) day is simpler and safer than patching state.
  useEffect(() => {
    const supabase = getSupabase();
    const channel = supabase
      .channel(`passdown-board-${date}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "passdown_entries", filter: `entry_date=eq.${date}` },
        () => refreshBoardSilently(date)
      )
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "passdown_updates" }, () =>
        refreshBoardSilently(date)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [date, refreshBoardSilently]);

  function saveMe(id: string) {
    setMeId(id);
    localStorage.setItem("passdown_me", id);
  }

  function saveShift(s: PassdownShift) {
    setShift(s);
    localStorage.setItem("passdown_shift", s);
  }

  // Up machines are hidden by default — most machines are fine most of the
  // time, so the board should read as "what needs attention", not a full
  // roster. "+新增機台" is the escape hatch (forcedVisibleKeys) for
  // deliberately bringing one back into view.
  const boardRows = useMemo(() => {
    const list = entries.filter((e) => e.status !== "up" || forcedVisibleKeys.has(machineKey(e)));
    return [...list].sort((a, b) => a.toolId.localeCompare(b.toolId) || a.module.localeCompare(b.module));
  }, [entries, forcedVisibleKeys]);

  const visibleKeys = useMemo(() => new Set(boardRows.map(machineKey)), [boardRows]);
  const existingKeys = useMemo(() => new Set(entries.map(machineKey)), [entries]);

  // Placeholder (carried-forward) rows aren't real passdown_entries rows yet
  // — any edit upserts one keyed on (entryDate, toolId, module), which is
  // exactly what materializes it. Matching by machineKey (not id) here is
  // what makes that swap-in transparent for both placeholder and real rows.
  async function handleStatusChange(entry: BoardEntry, status: PassdownStatus) {
    const updated = await upsertEntry(getSupabase(), {
      entryDate: entry.entryDate,
      toolId: entry.toolId,
      product: entry.product,
      module: entry.module,
      status,
      problemStatement: entry.problemStatement,
      remark: entry.remark,
      updatedById: meId ? Number(meId) : null,
    });
    setEntries((prev) => prev.map((e) => (machineKey(e) === machineKey(entry) ? updated : e)));
  }

  async function handleFieldSave(entry: BoardEntry, field: "problemStatement" | "remark", value: string) {
    const updated = await upsertEntry(getSupabase(), {
      entryDate: entry.entryDate,
      toolId: entry.toolId,
      product: entry.product,
      module: entry.module,
      status: entry.status,
      problemStatement: field === "problemStatement" ? value : entry.problemStatement,
      remark: field === "remark" ? value : entry.remark,
      updatedById: meId ? Number(meId) : null,
    });
    setEntries((prev) => prev.map((e) => (machineKey(e) === machineKey(entry) ? updated : e)));
  }

  async function handleAddNote(entry: BoardEntry, note: string) {
    if (!meId) throw new Error("請先在上方選擇你的名字");
    let target: PassdownEntry = entry;
    if (entry.isPlaceholder) {
      target = await upsertEntry(getSupabase(), {
        entryDate: entry.entryDate,
        toolId: entry.toolId,
        product: entry.product,
        module: entry.module,
        status: entry.status,
        problemStatement: entry.problemStatement,
        remark: entry.remark,
        updatedById: meId ? Number(meId) : null,
      });
      setEntries((prev) => prev.map((e) => (machineKey(e) === machineKey(entry) ? target : e)));
    }
    const created = await addUpdate(getSupabase(), { entryId: target.id, personId: Number(meId), shift, note });
    setUpdatesByEntry((prev) => {
      const next = new Map(prev);
      next.set(target.id, [...(next.get(target.id) ?? []), created]);
      return next;
    });
  }

  async function handleCreateEntry(input: {
    toolId: string;
    product: string;
    module: string;
    status: PassdownStatus;
    problemStatement: string;
  }) {
    const key = machineKey(input);
    // Already tracked today, just hidden (status Up) — reveal it as-is
    // instead of overwriting its real data with whatever the dialog's form
    // happened to hold.
    if (existingKeys.has(key)) {
      setForcedVisibleKeys((prev) => new Set(prev).add(key));
      return;
    }
    await upsertEntry(getSupabase(), {
      entryDate: date,
      toolId: input.toolId,
      product: input.product || null,
      module: input.module,
      status: input.status,
      problemStatement: input.problemStatement || null,
      remark: null,
      updatedById: meId ? Number(meId) : null,
    });
    setForcedVisibleKeys((prev) => new Set(prev).add(key));
    await refreshBoardSilently(date);
  }

  async function handleCopyEmail() {
    const list = boardRows;
    const text = buildEmailText(date, list, updatesByEntry);
    try {
      if (typeof ClipboardItem !== "undefined") {
        const html = buildEmailHtml(date, list, updatesByEntry);
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([text], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopyState("copied");
    } catch {
      setCopyState("error");
    } finally {
      setTimeout(() => setCopyState("idle"), 2000);
    }
  }

  async function handleHistorySearch() {
    setHistoryLoading(true);
    setHistoryError(null);
    setHistorySearched(true);
    try {
      const rows = await fetchEntriesHistory(getSupabase(), {
        from: historyFrom,
        to: historyTo,
        toolId: historyToolId.trim() ? `%${historyToolId.trim()}%` : undefined,
      });
      setHistoryResults(rows);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : String(err));
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1400px] px-4 py-8 md:px-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Passdown Tool</h1>
            <p className="text-muted-foreground mt-1 text-sm">F22 VXT 每日交接班看板</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={meId} onValueChange={saveMe}>
              <SelectTrigger size="sm" className="w-36">
                <SelectValue placeholder="我是..." />
              </SelectTrigger>
              <SelectContent>
                {people.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={shift} onValueChange={(v) => saveShift(v as PassdownShift)}>
              <SelectTrigger size="sm" className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Day</SelectItem>
                <SelectItem value="night">Night</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" asChild>
              <Link href="/passdown/people" aria-label="管理人員名單">
                <Settings className="h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/">回首頁</Link>
            </Button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button variant={view === "board" ? "default" : "outline"} size="sm" onClick={() => setView("board")}>
            今日看板
          </Button>
          <Button variant={view === "history" ? "default" : "outline"} size="sm" onClick={() => setView("history")}>
            歷史查詢
          </Button>
        </div>

        {view === "board" && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon-sm" onClick={() => setDate((d) => addDays(d, -1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-40"
                />
                <Button variant="outline" size="icon-sm" onClick={() => setDate((d) => addDays(d, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                {date !== todayStr() && (
                  <Button variant="ghost" size="sm" onClick={() => setDate(todayStr())}>
                    回到今天
                  </Button>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleCopyEmail} disabled={boardRows.length === 0}>
                  {copyState === "copied" ? (
                    <ClipboardCheck className="h-4 w-4" />
                  ) : (
                    <Clipboard className="h-4 w-4" />
                  )}
                  {copyState === "copied" ? "已複製" : copyState === "error" ? "複製失敗" : "複製成信件格式"}
                </Button>
                <Button size="sm" onClick={() => setNewEntryOpen(true)}>
                  <Plus className="h-4 w-4" />
                  新增機台
                </Button>
              </div>
            </div>

            {error && <p className="text-destructive mb-4 text-sm">{error}</p>}

            {loading ? (
              <p className="text-muted-foreground text-sm">載入中...</p>
            ) : boardRows.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {entries.length === 0
                  ? `${date} 尚無交接記錄。`
                  : "今天追蹤中的機台都是 Up,沒有需要交接的項目。需要記錄可以按右上「新增機台」。"}
              </p>
            ) : (
              <Card>
                <CardContent className="px-0 pt-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tool ID</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Module</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Problem Statement</TableHead>
                        <TableHead>Activities &amp; Planning</TableHead>
                        <TableHead>Remark</TableHead>
                        <TableHead>Updated By</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {boardRows.map((entry) => (
                        <PassdownEntryRow
                          key={machineKey(entry)}
                          entry={entry}
                          updates={updatesByEntry.get(entry.id) ?? []}
                          currentShift={shift}
                          onStatusChange={(status) => handleStatusChange(entry, status)}
                          onFieldSave={(field, value) => handleFieldSave(entry, field, value)}
                          onAddNote={(note) => handleAddNote(entry, note)}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            <NewEntryDialog
              open={newEntryOpen}
              onOpenChange={setNewEntryOpen}
              onCreate={handleCreateEntry}
              knownMachines={knownMachines}
              excludeKeys={visibleKeys}
              existingKeys={existingKeys}
            />
          </>
        )}

        {view === "history" && (
          <Card>
            <CardContent className="pt-6">
              <div className="mb-4 flex flex-wrap items-end gap-3">
                <div>
                  <Label className="mb-1">From</Label>
                  <Input type="date" value={historyFrom} onChange={(e) => setHistoryFrom(e.target.value)} />
                </div>
                <div>
                  <Label className="mb-1">To</Label>
                  <Input type="date" value={historyTo} onChange={(e) => setHistoryTo(e.target.value)} />
                </div>
                <div>
                  <Label className="mb-1">Tool ID</Label>
                  <Input
                    value={historyToolId}
                    onChange={(e) => setHistoryToolId(e.target.value)}
                    placeholder="留空查全部"
                    className="w-36"
                  />
                </div>
                <Button onClick={handleHistorySearch} disabled={historyLoading}>
                  {historyLoading ? "查詢中..." : "查詢"}
                </Button>
              </div>
              {historyError && <p className="text-destructive mb-3 text-sm">{historyError}</p>}
              {historySearched && !historyLoading && historyResults.length === 0 && (
                <p className="text-muted-foreground text-sm">查無資料。</p>
              )}
              {historyResults.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Tool</TableHead>
                      <TableHead>Module</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Problem</TableHead>
                      <TableHead>Remark</TableHead>
                      <TableHead>Updated By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyResults.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell>{e.entryDate}</TableCell>
                        <TableCell>{e.toolId}</TableCell>
                        <TableCell>{e.module}</TableCell>
                        <TableCell>{STATUS_LABELS[e.status]}</TableCell>
                        <TableCell className="max-w-xs truncate" title={e.problemStatement ?? ""}>
                          {e.problemStatement}
                        </TableCell>
                        <TableCell className="max-w-xs truncate" title={e.remark ?? ""}>
                          {e.remark}
                        </TableCell>
                        <TableCell>{e.updatedByName}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {historyResults.length >= 500 && (
                <p className="text-muted-foreground mt-2 text-xs">
                  結果已達 500 筆上限,請縮小日期範圍或指定 Tool ID。
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
