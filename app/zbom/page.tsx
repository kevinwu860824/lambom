"use client";

import * as XLSX from "xlsx-js-style";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Download } from "lucide-react";
import { createClient } from "@/lib/supabase";
import {
  compareZbomOptions,
  fetchAllZbomOptions,
  fetchZbomMachineNames,
  fetchZbomSectionNames,
  fetchZbomSectionOptions,
  type ZbomCompareResult,
  type ZbomOption,
} from "@/lib/bom";
import { useEmployeeGroup } from "@/lib/groups";
import { useTranslate } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RequireGroupPrompt } from "@/components/require-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LanguageSwitcher } from "@/components/language-switcher";

type SectionState = "loading" | "error" | ZbomOption[];

const zh: Record<string, string> = {
  "ZBOM Configuration Viewer": "ZBOM 配置檢視器",
  "View a machine's stored SAP Variant Configuration options.": "檢視機台已儲存的 SAP Variant Configuration 選項。",
  "Back to Comparison Tool": "返回比對工具",
  Machine: "機台",
  "Loading…": "載入中…",
  "Select machine": "選擇機台",
  "No ZBOM data stored yet.": "尚未儲存任何 ZBOM 資料。",
  "No ZBOM options stored for this machine.": "此機台尚未儲存任何 ZBOM 選項。",
  "Failed to load this section.": "此區段載入失敗。",
  "Option Type": "選項類型",
  "Option Selection": "選項內容",
  "View Single Machine": "檢視單一機台",
  "Compare Two Machines": "比對兩台機台",
  "Machine A": "機台 A",
  "Machine B": "機台 B",
  "Start Comparison": "開始比對",
  "Comparing…": "比對中…",
  "Comparison failed": "比對失敗",
  Matching: "相同",
  "Only in A": "僅 A 有",
  "Only in B": "僅 B 有",
  Mismatched: "不一致",
  Section: "區段",
  "A's Selection": "A 的內容",
  "B's Selection": "B 的內容",
  "No comparison data yet.": "尚未有比對結果。",
  "No differences here.": "這裡沒有差異。",
  "Download Excel": "下載 Excel",
  "Downloading…": "下載中…",
};

export default function ZbomPage() {
  const t = useTranslate(zh);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  const { allowedMachines, employeeId, notFound, loading: groupLoading } = useEmployeeGroup();

  const [machineNames, setMachineNames] = useState<string[]>([]);
  const [machine, setMachine] = useState("");
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Section names/order for the currently-selected machine — a small,
  // fast "index" fetched up front so the nav + collapsed section list
  // appear immediately, before any section's actual option rows are
  // fetched.
  const [sectionOrder, setSectionOrder] = useState<string[]>([]);
  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set());
  // Keyed by section name (not index) — duplicate-named sections share one
  // fetch/cache, matching how fetchZbomSectionOptions itself groups rows
  // (by section name across the whole machine), same as the old
  // fetchZbomOptions grouping.
  const [sectionData, setSectionData] = useState<Map<string, SectionState>>(new Map());
  const requestedSectionsRef = useRef<Set<string>>(new Set());

  const [viewMode, setViewMode] = useState<"single" | "compare">("single");
  const [machineA, setMachineA] = useState("");
  const [machineB, setMachineB] = useState("");
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareResult, setCompareResult] = useState<ZbomCompareResult | null>(null);

  async function handleCompareClick() {
    if (!machineA || !machineB) return;
    setCompareLoading(true);
    setCompareError(null);
    try {
      const [optionsA, optionsB] = await Promise.all([
        fetchAllZbomOptions(getSupabase(), machineA),
        fetchAllZbomOptions(getSupabase(), machineB),
      ]);
      setCompareResult(compareZbomOptions(optionsA, optionsB));
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : String(err));
    } finally {
      setCompareLoading(false);
    }
  }

  useEffect(() => {
    if (!allowedMachines) return;
    fetchZbomMachineNames(getSupabase())
      .then((names) => setMachineNames(names.filter((name) => allowedMachines.has(name))))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setListLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedMachines]);

  function ensureSectionLoaded(name: string, machineName: string) {
    if (requestedSectionsRef.current.has(name)) return;
    requestedSectionsRef.current.add(name);
    setSectionData((prev) => new Map(prev).set(name, "loading"));
    fetchZbomSectionOptions(getSupabase(), machineName, name)
      .then((options) => setSectionData((prev) => new Map(prev).set(name, options)))
      .catch(() => setSectionData((prev) => new Map(prev).set(name, "error")));
  }

  function expandSection(index: number) {
    const name = sectionOrder[index];
    if (!name) return;
    setExpandedIndices((prev) => new Set(prev).add(index));
    ensureSectionLoaded(name, machine);
  }

  function toggleSection(index: number) {
    setExpandedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
    const name = sectionOrder[index];
    if (name) ensureSectionLoaded(name, machine);
  }

  function jumpToSection(index: number) {
    expandSection(index);
    requestAnimationFrame(() => {
      document.getElementById(`zbom-section-${index}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }

  function handleMachineChange(value: string) {
    setMachine(value);
    setSectionOrder([]);
    setExpandedIndices(new Set());
    setSectionData(new Map());
    requestedSectionsRef.current = new Set();
    setError(null);
    setSectionsLoading(true);
    fetchZbomSectionNames(getSupabase(), value)
      .then(setSectionOrder)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSectionsLoading(false));
  }

  async function downloadExcel() {
    if (!machine || sectionOrder.length === 0 || downloadLoading) return;

    setDownloadLoading(true);
    setError(null);
    try {
      const options = (
        await Promise.all(sectionOrder.map((name) => fetchZbomSectionOptions(getSupabase(), machine, name)))
      ).flat();
      const workbook = XLSX.utils.book_new();
      const summaryRows = [
        ["Item", "Value"],
        ["Machine", machine],
        ["Sections", sectionOrder.length],
        ["Options", options.length],
      ];
      const optionRows = [
        ["Section", "Option Type", "Option Selection"],
        ...options.map((option) => [option.section, option.optionType, option.optionSelection ?? ""]),
      ];

      const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
      const optionsSheet = XLSX.utils.aoa_to_sheet(optionRows);
      summarySheet["!cols"] = [{ wch: 18 }, { wch: 45 }];
      optionsSheet["!cols"] = [{ wch: 35 }, { wch: 30 }, { wch: 60 }];
      XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
      XLSX.utils.book_append_sheet(workbook, optionsSheet, "ZBOM Options");

      const safeMachineName = machine.replace(/[\\/:*?"<>|]+/g, "_");
      XLSX.writeFile(workbook, `ZBOM_${safeMachineName}.xlsx`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloadLoading(false);
    }
  }

  if (groupLoading) return null;
  if (!allowedMachines) {
    return (
      <div className="bg-background min-h-screen">
        <RequireGroupPrompt notFound={notFound} employeeId={employeeId} />
      </div>
    );
  }

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("ZBOM Configuration Viewer")}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("View a machine's stored SAP Variant Configuration options.")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Button variant="outline" size="icon" asChild aria-label={t("Back to Comparison Tool")}>
              <Link href="/lambom">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="mb-6 flex items-center gap-2">
          <div className="inline-flex rounded-md border p-0.5">
            <Button
              type="button"
              size="sm"
              variant={viewMode === "single" ? "default" : "ghost"}
              className="h-7"
              onClick={() => setViewMode("single")}
            >
              {t("View Single Machine")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewMode === "compare" ? "default" : "ghost"}
              className="h-7"
              onClick={() => setViewMode("compare")}
            >
              {t("Compare Two Machines")}
            </Button>
          </div>
        </div>

        {error && <p className="text-destructive mb-4 text-sm">{error}</p>}

        {viewMode === "single" && (
          <>
            <Card className="mb-6">
              <CardContent>
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium">{t("Machine")}</label>
                  <Select value={machine} onValueChange={handleMachineChange} disabled={listLoading}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={listLoading ? t("Loading…") : t("Select machine")} />
                    </SelectTrigger>
                    <SelectContent>
                      {machineNames.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {machine && sectionOrder.length > 0 && (
                    <div className="mt-3 flex justify-end">
                      <Button variant="outline" onClick={downloadExcel} disabled={downloadLoading}>
                        <Download className="h-4 w-4" />
                        {downloadLoading ? t("Downloading…") : t("Download Excel")}
                      </Button>
                    </div>
                  )}
                  {!listLoading && machineNames.length === 0 && (
                    <p className="text-muted-foreground mt-1 text-sm">{t("No ZBOM data stored yet.")}</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {sectionsLoading && <p className="text-muted-foreground text-sm">{t("Loading…")}</p>}

            {!sectionsLoading && machine && sectionOrder.length === 0 && !error && (
              <p className="text-muted-foreground text-sm">{t("No ZBOM options stored for this machine.")}</p>
            )}

            {!sectionsLoading && sectionOrder.length > 0 && (
              <div className="flex flex-col gap-6 md:flex-row md:items-start">
                <nav className="bg-background top-8 shrink-0 self-start md:sticky md:w-56">
                  <ul className="space-y-0.5">
                    {sectionOrder.map((name, index) => (
                      <li key={index}>
                        <button
                          type="button"
                          onClick={() => jumpToSection(index)}
                          className="hover:bg-accent w-full truncate rounded-sm px-2 py-1 text-left text-sm"
                          title={name}
                        >
                          {name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </nav>

                <div className="grid min-w-0 flex-1 gap-4">
                  {sectionOrder.map((name, index) => {
                    const expanded = expandedIndices.has(index);
                    const data = sectionData.get(name);
                    return (
                      <Card key={index} id={`zbom-section-${index}`}>
                        <CardContent>
                          <button
                            type="button"
                            onClick={() => toggleSection(index)}
                            className="hover:bg-accent -mx-2 flex w-[calc(100%+1rem)] items-center gap-1.5 rounded-sm px-2 py-1 text-left text-sm font-medium"
                          >
                            <ChevronRight
                              className={cn("h-3.5 w-3.5 shrink-0 transition-transform", expanded && "rotate-90")}
                            />
                            {name}
                          </button>

                          {expanded && (
                            <div className="mt-3">
                              {data === "loading" && <p className="text-muted-foreground text-sm">{t("Loading…")}</p>}
                              {data === "error" && (
                                <p className="text-destructive text-sm">{t("Failed to load this section.")}</p>
                              )}
                              {data && data !== "loading" && data !== "error" && (
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>{t("Option Type")}</TableHead>
                                      <TableHead>{t("Option Selection")}</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {data.map((opt, idx) => (
                                      <TableRow key={`${opt.optionType}-${idx}`}>
                                        <TableCell>{opt.optionType}</TableCell>
                                        <TableCell>{opt.optionSelection ?? "-"}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              )}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {viewMode === "compare" && (
          <>
            <Card className="mb-6">
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="grid gap-1.5">
                    <label className="text-sm font-medium">{t("Machine A")}</label>
                    <Select value={machineA} onValueChange={setMachineA} disabled={listLoading}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={listLoading ? t("Loading…") : t("Select machine")} />
                      </SelectTrigger>
                      <SelectContent>
                        {machineNames.map((name) => (
                          <SelectItem key={name} value={name}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-sm font-medium">{t("Machine B")}</label>
                    <Select value={machineB} onValueChange={setMachineB} disabled={listLoading}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={listLoading ? t("Loading…") : t("Select machine")} />
                      </SelectTrigger>
                      <SelectContent>
                        {machineNames.map((name) => (
                          <SelectItem key={name} value={name}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button className="mt-4" onClick={handleCompareClick} disabled={compareLoading || !machineA || !machineB}>
                  {compareLoading ? t("Comparing…") : t("Start Comparison")}
                </Button>
              </CardContent>
            </Card>

            {compareError && (
              <p className="text-destructive mb-4 text-sm">
                {t("Comparison failed")}: {compareError}
              </p>
            )}

            {!compareResult && !compareLoading && !compareError && (
              <p className="text-muted-foreground text-sm">{t("No comparison data yet.")}</p>
            )}

            {compareResult && (
              <div className="grid gap-6">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    {t("Matching")} {compareResult.matchedCount}
                  </Badge>
                  <Badge variant={compareResult.mismatched.length > 0 ? "destructive" : "secondary"}>
                    {t("Mismatched")} {compareResult.mismatched.length}
                  </Badge>
                  <Badge variant="outline">
                    {t("Only in A")} {compareResult.onlyA.length}
                  </Badge>
                  <Badge variant="outline">
                    {t("Only in B")} {compareResult.onlyB.length}
                  </Badge>
                </div>

                <Card>
                  <CardContent>
                    <h2 className="mb-2 text-sm font-medium">{t("Mismatched")}</h2>
                    {compareResult.mismatched.length === 0 ? (
                      <p className="text-muted-foreground text-sm italic">{t("No differences here.")}</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("Section")}</TableHead>
                            <TableHead>{t("Option Type")}</TableHead>
                            <TableHead>{t("A's Selection")}</TableHead>
                            <TableHead>{t("B's Selection")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {compareResult.mismatched.map((m, idx) => (
                            <TableRow key={idx} className="text-red-600 dark:text-red-400">
                              <TableCell>{m.section}</TableCell>
                              <TableCell>{m.optionType}</TableCell>
                              <TableCell>{m.onlyInA.join(", ") || "-"}</TableCell>
                              <TableCell>{m.onlyInB.join(", ") || "-"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>

                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardContent>
                      <h2 className="mb-2 text-sm font-medium">{t("Only in A")}</h2>
                      {compareResult.onlyA.length === 0 ? (
                        <p className="text-muted-foreground text-sm italic">{t("No differences here.")}</p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t("Section")}</TableHead>
                              <TableHead>{t("Option Type")}</TableHead>
                              <TableHead>{t("Option Selection")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {compareResult.onlyA.map((opt, idx) => (
                              <TableRow key={idx}>
                                <TableCell>{opt.section}</TableCell>
                                <TableCell>{opt.optionType}</TableCell>
                                <TableCell>{opt.optionSelection ?? "-"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent>
                      <h2 className="mb-2 text-sm font-medium">{t("Only in B")}</h2>
                      {compareResult.onlyB.length === 0 ? (
                        <p className="text-muted-foreground text-sm italic">{t("No differences here.")}</p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t("Section")}</TableHead>
                              <TableHead>{t("Option Type")}</TableHead>
                              <TableHead>{t("Option Selection")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {compareResult.onlyB.map((opt, idx) => (
                              <TableRow key={idx}>
                                <TableCell>{opt.section}</TableCell>
                                <TableCell>{opt.optionType}</TableCell>
                                <TableCell>{opt.optionSelection ?? "-"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
