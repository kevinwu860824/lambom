"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { buildBomTree, fetchBomTreeItems, fetchMachineGroups, type BomTreeNode, type MachineGroup } from "@/lib/bom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BomTreeNodeRow } from "@/components/bom-tree-node";

interface SubpartTree {
  bomId: number;
  sourceFile: string;
  roots: BomTreeNode[];
}

function collectExpandablePaths(nodes: BomTreeNode[], idPrefix: string, out: Set<string>) {
  for (const node of nodes) {
    if (node.children.length > 0) {
      out.add(`${idPrefix}:${node.path}`);
      collectExpandablePaths(node.children, idPrefix, out);
    }
  }
}

export default function TreePage() {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  const [machineGroups, setMachineGroups] = useState<MachineGroup[]>([]);
  const [machine, setMachine] = useState("");
  const [subpartTrees, setSubpartTrees] = useState<SubpartTree[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [treeLoading, setTreeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchMachineGroups(getSupabase())
      .then(({ machineGroups }) => setMachineGroups(machineGroups))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setListLoading(false));
  }, []);

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    const all = new Set<string>();
    for (const tree of subpartTrees) collectExpandablePaths(tree.roots, String(tree.bomId), all);
    setExpandedIds(all);
  }

  function collapseAll() {
    setExpandedIds(new Set());
  }

  async function handleMachineChange(value: string) {
    setMachine(value);
    setSubpartTrees([]);
    setError(null);
    setExpandedIds(new Set());
    setTreeLoading(true);
    try {
      const group = machineGroups.find((g) => g.machine === value);
      if (!group) return;

      const trees = await Promise.all(
        group.subparts.map(async (entry) => {
          const items = await fetchBomTreeItems(getSupabase(), entry.bomId, entry.source_file);
          return { bomId: entry.bomId, sourceFile: entry.source_file, roots: buildBomTree(items) };
        })
      );
      setSubpartTrees(trees);

      // Auto-expand just each subpart's root(s) so there's something
      // useful to see immediately without a huge initial render.
      const initial = new Set<string>();
      for (const tree of trees) {
        for (const root of tree.roots) {
          if (root.children.length > 0) initial.add(`${tree.bomId}:${root.path}`);
        }
      }
      setExpandedIds(initial);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTreeLoading(false);
    }
  }

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">BOM Structure Viewer</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Pick a machine to view its parts hierarchically, expand/collapse as needed.
            </p>
          </div>
          <Link href="/" className="text-sm underline underline-offset-4">
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
                  {machineGroups.map((group) => (
                    <SelectItem key={group.machine} value={group.machine}>
                      {group.machine}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {treeLoading && <p className="text-muted-foreground text-sm">Loading…</p>}

        {!treeLoading && subpartTrees.length > 0 && (
          <div className="mb-3 flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={expandAll}>
              <ChevronsUpDown className="h-3.5 w-3.5" />
              Expand All
            </Button>
            <Button size="sm" variant="outline" onClick={collapseAll}>
              <ChevronsDownUp className="h-3.5 w-3.5" />
              Collapse All
            </Button>
          </div>
        )}

        <div className="grid gap-4">
          {subpartTrees.map((tree) => (
            <Card key={tree.bomId}>
              <CardContent>
                <h2 className="mb-2 text-sm font-medium">{tree.sourceFile}</h2>
                {tree.roots.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No items.</p>
                ) : (
                  <div>
                    {tree.roots.map((root) => (
                      <BomTreeNodeRow
                        key={root.path}
                        node={root}
                        idPrefix={String(tree.bomId)}
                        expandedPaths={expandedIds}
                        onToggle={toggleExpanded}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
