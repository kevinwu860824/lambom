"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, PackageCheck, RotateCcw, Settings, ShoppingCart, Truck } from "lucide-react";
import { createClient } from "@/lib/supabase";
import {
  createLog,
  fetchLogs,
  fetchMachines,
  fetchModels,
  updateLogStatus,
  type InventoryLog,
  type InventoryMachine,
  type InventoryModel,
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
  "Machine Settings": "機台設定",
  "Report a Part": "回報零件",
  Machine: "機台",
  "Select machine": "選擇機台",
  "Part Name": "零件名稱",
  "Select from BOM…": "從 BOM 表中選擇…",
  "No BOM data for this model": "此機型暫無 BOM 資料",
  "Select a machine first": "請先選擇機台",
  "Enter custom part…": "手動輸入自定義零件",
  "Type the part name/spec…": "輸入零件名稱/規格…",
  "Back to BOM list": "返回 BOM 清單",
  "Mark as a loan (not a repair)": "標記為零件借出(非報修)",
  "Borrower": "借用人",
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

export default function InventoryPage() {
  const t = useTranslate(zh);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  const { employeeId, notFound, loading: groupLoading } = useEmployeeGroup();

  const [machines, setMachines] = useState<InventoryMachine[]>([]);
  const [models, setModels] = useState<InventoryModel[]>([]);
  const [logs, setLogs] = useState<InventoryLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "archive">("active");
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  // Report form state
  const [selectedMachineId, setSelectedMachineId] = useState("");
  const [partName, setPartName] = useState("");
  const [customPart, setCustomPart] = useState(false);
  const [isLoan, setIsLoan] = useState(false);
  const [borrower, setBorrower] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabase();
      const [m, mo, l] = await Promise.all([fetchMachines(supabase), fetchModels(supabase), fetchLogs(supabase)]);
      setMachines(m);
      setModels(mo);
      setLogs(l);
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

  const selectedMachine = machines.find((m) => String(m.id) === selectedMachineId) ?? null;
  const selectedModel = selectedMachine?.modelId
    ? models.find((mo) => mo.id === selectedMachine.modelId) ?? null
    : null;
  const bomList = selectedModel?.bomData ?? [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMachine || !partName.trim()) return;

    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      await createLog(getSupabase(), {
        machineId: selectedMachine.id,
        partName: partName.trim(),
        isLoan,
        borrower: isLoan ? borrower.trim() || null : null,
        reporterEmployeeId: employeeId,
      });
      setMessage(isLoan ? t("Loan recorded.") : t("Part reported."));
      setSelectedMachineId("");
      setPartName("");
      setCustomPart(false);
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
            <Button variant="outline" size="icon" asChild aria-label={t("Machine Settings")}>
              <Link href="/inventory/machines">
                <Settings className="h-4 w-4" />
              </Link>
            </Button>
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
                  value={selectedMachineId}
                  onValueChange={(v) => {
                    setSelectedMachineId(v);
                    setPartName("");
                    setCustomPart(false);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("Select machine")} />
                  </SelectTrigger>
                  <SelectContent>
                    {machines.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.code} - {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <label className="text-sm font-medium">{t("Part Name")}</label>
                {!customPart ? (
                  <div className="flex gap-2">
                    <Select
                      value={partName}
                      onValueChange={(v) => setPartName(v)}
                      disabled={!selectedMachine}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue
                          placeholder={
                            !selectedMachine
                              ? t("Select a machine first")
                              : bomList.length > 0
                                ? t("Select from BOM…")
                                : t("No BOM data for this model")
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {bomList.map((item) => (
                          <SelectItem key={item} value={item}>
                            {item}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0"
                      disabled={!selectedMachine}
                      onClick={() => {
                        setCustomPart(true);
                        setPartName("");
                      }}
                    >
                      {t("Enter custom part…")}
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      autoFocus
                      required
                      placeholder={t("Type the part name/spec…")}
                      value={partName}
                      onChange={(e) => setPartName(e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => {
                        setCustomPart(false);
                        setPartName("");
                      }}
                    >
                      {t("Back to BOM list")}
                    </Button>
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

              <Button type="submit" disabled={submitting || !selectedMachineId || !partName.trim()}>
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
                      <p className="text-muted-foreground text-xs">
                        {log.machineCode} · {log.machineName}
                      </p>
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
