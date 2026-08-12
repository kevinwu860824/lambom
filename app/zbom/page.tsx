"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { fetchZbomMachineNames, fetchZbomSectionNames, fetchZbomSectionOptions, type ZbomOption } from "@/lib/bom";
import { useEmployeeGroup } from "@/lib/groups";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { RequireGroupPrompt } from "@/components/require-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type SectionState = "loading" | "error" | ZbomOption[];

export default function ZbomPage() {
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
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set());
  // Keyed by section name (not index) — duplicate-named sections share one
  // fetch/cache, matching how fetchZbomSectionOptions itself groups rows
  // (by section name across the whole machine), same as the old
  // fetchZbomOptions grouping.
  const [sectionData, setSectionData] = useState<Map<string, SectionState>>(new Map());
  const requestedSectionsRef = useRef<Set<string>>(new Set());

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
            <h1 className="text-2xl font-semibold tracking-tight">ZBOM Configuration Viewer</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              View a machine&apos;s stored SAP Variant Configuration options.
            </p>
          </div>
          <Link href="/lambom" className="text-sm underline underline-offset-4">
            Back to Comparison Tool
          </Link>
        </div>

        {error && <p className="text-destructive mb-4 text-sm">{error}</p>}

        <Card className="mb-6">
          <CardContent>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Machine</label>
              <Select value={machine} onValueChange={handleMachineChange} disabled={listLoading}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={listLoading ? "Loading…" : "Select machine"} />
                </SelectTrigger>
                <SelectContent>
                  {machineNames.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!listLoading && machineNames.length === 0 && (
                <p className="text-muted-foreground mt-1 text-sm">No ZBOM data stored yet.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {sectionsLoading && <p className="text-muted-foreground text-sm">Loading…</p>}

        {!sectionsLoading && machine && sectionOrder.length === 0 && !error && (
          <p className="text-muted-foreground text-sm">No ZBOM options stored for this machine.</p>
        )}

        {!sectionsLoading && sectionOrder.length > 0 && (
          <div className="flex flex-col gap-6 md:flex-row md:items-start">
            <nav className="bg-background top-8 shrink-0 self-start md:sticky md:w-56">
              <ul className="grid gap-0.5">
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
                        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", expanded && "rotate-90")} />
                        {name}
                      </button>

                      {expanded && (
                        <div className="mt-3">
                          {data === "loading" && <p className="text-muted-foreground text-sm">Loading…</p>}
                          {data === "error" && <p className="text-destructive text-sm">Failed to load this section.</p>}
                          {data && data !== "loading" && data !== "error" && (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Option Type</TableHead>
                                  <TableHead>Option Selection</TableHead>
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
      </div>
    </div>
  );
}
