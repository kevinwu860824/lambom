"use client";

import { useEffect, useRef, useState } from "react";
import { Star, Check, ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { fetchMachineGroups, type MachineGroup } from "@/lib/bom";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface SearchResultRow {
  id: number;
  part_no: string;
  description: string | null;
  qty: number | null;
  uom: string | null;
  bom_machines: { machine_name: string; source_file: string } | null;
}

const RESULT_LIMIT = 200;

export function DescriptionSearch({ onKeyPartAdded }: { onKeyPartAdded?: () => void }) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) {
      supabaseRef.current = createClient();
    }
    return supabaseRef.current;
  }

  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<SearchResultRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [machineGroups, setMachineGroups] = useState<MachineGroup[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [checkedMachines, setCheckedMachines] = useState<Set<string>>(new Set());
  const [selectedBomIds, setSelectedBomIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetchMachineGroups(getSupabase())
      .then(({ machineGroups: groups }) => {
        setMachineGroups(groups);
        // Default to everything included, so the panel reads as "opt-out"
        // rather than starting empty and looking like nothing will match.
        setCheckedMachines(new Set(groups.map((g) => g.machine)));
        setSelectedBomIds(new Set(groups.flatMap((g) => g.subparts.map((s) => s.bomId))));
      })
      .catch(() => {
        // Filter panel just won't have options; the search itself still works unfiltered.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function machineSubpartState(group: MachineGroup): boolean | "indeterminate" {
    const checkedCount = group.subparts.filter((s) => selectedBomIds.has(s.bomId)).length;
    if (checkedCount === 0) return false;
    if (checkedCount === group.subparts.length) return true;
    return "indeterminate";
  }

  function toggleAllMachines() {
    const allChecked = checkedMachines.size === machineGroups.length;
    if (allChecked) {
      setCheckedMachines(new Set());
      setSelectedBomIds(new Set());
    } else {
      setCheckedMachines(new Set(machineGroups.map((g) => g.machine)));
      setSelectedBomIds(new Set(machineGroups.flatMap((g) => g.subparts.map((s) => s.bomId))));
    }
  }

  function toggleMachineChecked(group: MachineGroup) {
    const isChecked = checkedMachines.has(group.machine);
    setCheckedMachines((prev) => {
      const next = new Set(prev);
      if (isChecked) next.delete(group.machine);
      else next.add(group.machine);
      return next;
    });
    setSelectedBomIds((prev) => {
      const next = new Set(prev);
      group.subparts.forEach((s) => {
        if (isChecked) next.delete(s.bomId);
        else next.add(s.bomId);
      });
      return next;
    });
  }

  function toggleAllSubpartsForMachine(group: MachineGroup) {
    const fullyChecked = machineSubpartState(group) === true;
    setSelectedBomIds((prev) => {
      const next = new Set(prev);
      group.subparts.forEach((s) => {
        if (fullyChecked) next.delete(s.bomId);
        else next.add(s.bomId);
      });
      return next;
    });
  }

  function toggleSubpart(bomId: number) {
    setSelectedBomIds((prev) => {
      const next = new Set(prev);
      if (next.has(bomId)) next.delete(bomId);
      else next.add(bomId);
      return next;
    });
  }

  function clearFilter() {
    setCheckedMachines(new Set(machineGroups.map((g) => g.machine)));
    setSelectedBomIds(new Set(machineGroups.flatMap((g) => g.subparts.map((s) => s.bomId))));
  }

  const totalBomCount = machineGroups.reduce((sum, g) => sum + g.subparts.length, 0);
  const isFiltering = selectedBomIds.size > 0 && selectedBomIds.size < totalBomCount;

  async function runSearch(term: string, bomIds: Set<number>) {
    const trimmed = term.trim();
    if (!trimmed) {
      setResults(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const terms = trimmed.split(/\s+/).filter(Boolean);
      let query = getSupabase()
        .from("bom_items")
        .select("id,part_no,description,qty,uom,bom_machines(machine_name,source_file)")
        .limit(RESULT_LIMIT);

      if (bomIds.size > 0) {
        query = query.in("bom_id", Array.from(bomIds));
      }

      for (const term of terms) {
        query = query.or(`description.ilike.%${term}%,part_no.ilike.%${term}%`);
      }

      const { data, error: searchError } = await query;
      if (searchError) throw new Error(searchError.message);
      setResults((data ?? []) as unknown as SearchResultRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResults(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runSearch(keyword, selectedBomIds);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, selectedBomIds]);

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Part No. / Description Search</CardTitle>
      </CardHeader>
      <CardContent>
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="Enter keywords to search part numbers or descriptions across all machines — separate multiple keywords with spaces (all must match)"
        />

        <div className="mt-3">
          <button
            type="button"
            onClick={() => setFilterOpen((v) => !v)}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
          >
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", filterOpen && "rotate-180")}
            />
            Filter Machines / Subparts
            {isFiltering && (
              <Badge variant="secondary" className="ml-1">
                {selectedBomIds.size}
              </Badge>
            )}
          </button>

          {filterOpen && (
            <div className="mt-2 rounded-md border p-3">
              {isFiltering && (
                <button
                  type="button"
                  onClick={clearFilter}
                  className="text-muted-foreground mb-2 block text-xs underline"
                >
                  Clear filter
                </button>
              )}

              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  checked={
                    checkedMachines.size === 0
                      ? false
                      : checkedMachines.size === machineGroups.length
                        ? true
                        : "indeterminate"
                  }
                  onCheckedChange={toggleAllMachines}
                />
                All machines
              </label>
              <div className="mt-1 max-h-[160px] overflow-y-auto grid gap-1 pl-6">
                {machineGroups.map((group) => (
                  <label key={group.machine} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={checkedMachines.has(group.machine)}
                      onCheckedChange={() => toggleMachineChecked(group)}
                    />
                    {group.machine}
                  </label>
                ))}
              </div>

              {checkedMachines.size > 0 && (
                <div className="mt-3 grid gap-3 border-t pt-3">
                  <p className="text-muted-foreground text-xs font-medium">
                    Subparts (all included by default, uncheck individually to exclude)
                  </p>
                  <div className="max-h-[240px] overflow-y-auto grid gap-2">
                    {machineGroups
                      .filter((group) => checkedMachines.has(group.machine))
                      .map((group) => (
                        <div key={group.machine}>
                          <label className="flex items-center gap-2 text-sm font-medium">
                            <Checkbox
                              checked={machineSubpartState(group)}
                              onCheckedChange={() => toggleAllSubpartsForMachine(group)}
                            />
                            {group.machine} (all)
                          </label>
                          <div className="mt-1 grid gap-1 pl-6">
                            {group.subparts.map((s) => (
                              <label key={s.bomId} className="flex items-center gap-2 text-xs">
                                <Checkbox
                                  checked={selectedBomIds.has(s.bomId)}
                                  onCheckedChange={() => toggleSubpart(s.bomId)}
                                />
                                {s.source_file}
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-4">
          {loading && <p className="text-muted-foreground text-sm">Searching…</p>}
          {error && <p className="text-destructive text-sm">Search failed: {error}</p>}
          {!loading && !error && results && results.length === 0 && (
            <p className="text-muted-foreground text-sm italic">No matching results</p>
          )}
          {!loading && results && results.length > 0 && (
            <>
              <p className="text-muted-foreground mb-2 text-xs">
                {results.length} result(s)
                {results.length === RESULT_LIMIT ? ` (showing only the first ${RESULT_LIMIT})` : ""}
              </p>
              <div className="max-h-[400px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Machine</TableHead>
                      <TableHead>Subpart</TableHead>
                      <TableHead>Part No.</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>{row.bom_machines?.machine_name ?? "-"}</TableCell>
                        <TableCell>{row.bom_machines?.source_file ?? "-"}</TableCell>
                        <TableCell>{row.part_no}</TableCell>
                        <TableCell>{row.description}</TableCell>
                        <TableCell>{row.qty ?? "-"}</TableCell>
                        <TableCell>{row.uom ?? ""}</TableCell>
                        <TableCell>
                          <AddKeyPartButton
                            partNo={row.part_no}
                            description={row.description}
                            machineName={row.bom_machines?.machine_name ?? null}
                            sourceFile={row.bom_machines?.source_file ?? null}
                            onAdded={onKeyPartAdded}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AddKeyPartButton({
  partNo,
  description,
  machineName,
  sourceFile,
  onAdded,
}: {
  partNo: string;
  description: string | null;
  machineName: string | null;
  sourceFile: string | null;
  onAdded?: () => void;
}) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) {
      supabaseRef.current = createClient();
    }
    return supabaseRef.current;
  }

  const [open, setOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    const trimmed = customName.trim();
    if (!trimmed) return;

    setSaving(true);
    setError(null);

    try {
      const { error: insertError } = await getSupabase()
        .from("key_parts")
        .insert({
          part_no: partNo,
          description,
          custom_name: trimmed,
          machine_name: machineName,
          source_file: sourceFile,
        });
      if (insertError) throw new Error(insertError.message);

      setSaved(true);
      setOpen(false);
      setCustomName("");
      onAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label="Add key part">
          {saved ? (
            <Check className="h-4 w-4 text-emerald-600" />
          ) : (
            <Star className="text-muted-foreground h-4 w-4" />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Key Part</DialogTitle>
          <DialogDescription>Give this part a memorable custom name.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="rounded-md border p-2 text-sm">
            <p className="font-medium">{partNo}</p>
            <p className="text-muted-foreground">{description}</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`custom-name-${partNo}`}>Custom Name</Label>
            <Input
              id={`custom-name-${partNo}`}
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="e.g. Main Power Switch"
              disabled={saving}
            />
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>

        <DialogFooter>
          <Button onClick={handleSave} disabled={!customName.trim() || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
