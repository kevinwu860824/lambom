"use client";

import { useEffect, useRef, useState } from "react";
import { Star, Check } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export function DescriptionSearch() {
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

  async function runSearch(term: string) {
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
      runSearch(keyword);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword]);

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>料號 / 描述搜尋</CardTitle>
      </CardHeader>
      <CardContent>
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="輸入關鍵字搜尋所有機台的料號或描述,可用空白分隔多個關鍵字(全部都要符合)"
        />

        <div className="mt-4">
          {loading && <p className="text-muted-foreground text-sm">搜尋中…</p>}
          {error && <p className="text-destructive text-sm">搜尋失敗:{error}</p>}
          {!loading && !error && results && results.length === 0 && (
            <p className="text-muted-foreground text-sm italic">沒有符合的結果</p>
          )}
          {!loading && results && results.length > 0 && (
            <>
              <p className="text-muted-foreground mb-2 text-xs">
                共 {results.length} 筆
                {results.length === RESULT_LIMIT ? `(僅顯示前 ${RESULT_LIMIT} 筆)` : ""}
              </p>
              <div className="max-h-[400px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>機台</TableHead>
                      <TableHead>子項</TableHead>
                      <TableHead>料號</TableHead>
                      <TableHead>描述</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>操作</TableHead>
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
}: {
  partNo: string;
  description: string | null;
  machineName: string | null;
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
        .insert({ part_no: partNo, description, custom_name: trimmed, machine_name: machineName });
      if (insertError) throw new Error(insertError.message);

      setSaved(true);
      setOpen(false);
      setCustomName("");
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
        <Button size="icon-sm" variant="ghost" aria-label="加入重要零件">
          {saved ? (
            <Check className="h-4 w-4 text-emerald-600" />
          ) : (
            <Star className="text-muted-foreground h-4 w-4" />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>加入重要零件</DialogTitle>
          <DialogDescription>幫這個零件取一個好記的自訂名稱。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="rounded-md border p-2 text-sm">
            <p className="font-medium">{partNo}</p>
            <p className="text-muted-foreground">{description}</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`custom-name-${partNo}`}>自訂名稱</Label>
            <Input
              id={`custom-name-${partNo}`}
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="例如:主電源開關"
              disabled={saving}
            />
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>

        <DialogFooter>
          <Button onClick={handleSave} disabled={!customName.trim() || saving}>
            {saving ? "儲存中…" : "儲存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
