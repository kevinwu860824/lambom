"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { fetchZbomMachineNames, fetchZbomOptions, type ZbomSection } from "@/lib/bom";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function ZbomPage() {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  const [machineNames, setMachineNames] = useState<string[]>([]);
  const [machine, setMachine] = useState("");
  const [sections, setSections] = useState<ZbomSection[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchZbomMachineNames(getSupabase())
      .then(setMachineNames)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setListLoading(false));
  }, []);

  function handleMachineChange(value: string) {
    setMachine(value);
    setSections([]);
    setError(null);
    setSectionsLoading(true);
    fetchZbomOptions(getSupabase(), value)
      .then(setSections)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSectionsLoading(false));
  }

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-6">
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

        {!sectionsLoading && machine && sections.length === 0 && !error && (
          <p className="text-muted-foreground text-sm">No ZBOM options stored for this machine.</p>
        )}

        <div className="grid gap-4">
          {sections.map((section) => (
            <Card key={section.section}>
              <CardContent>
                <h2 className="mb-3 text-sm font-medium">{section.section}</h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Option Type</TableHead>
                      <TableHead>Option Selection</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {section.options.map((opt, idx) => (
                      <TableRow key={`${opt.optionType}-${idx}`}>
                        <TableCell>{opt.optionType}</TableCell>
                        <TableCell>{opt.optionSelection ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
