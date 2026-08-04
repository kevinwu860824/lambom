"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, ChevronUp } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { buildBomTree, fetchBomTreeItems, fetchMachineGroups, type BomTreeNode, type MachineGroup } from "@/lib/bom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BomTreeNodeRow, nodeMatchesQuery, normalizeSearchText } from "@/components/bom-tree-node";

interface SubpartTree {
  bomId: number;
  sourceFile: string;
  roots: BomTreeNode[];
}

interface TreeMatch {
  id: string;
}

function collectExpandablePaths(nodes: BomTreeNode[], idPrefix: string, out: Set<string>) {
  for (const node of nodes) {
    if (node.children.length > 0) {
      out.add(`${idPrefix}:${node.path}`);
      collectExpandablePaths(node.children, idPrefix, out);
    }
  }
}

function collectMatches(subpartTrees: SubpartTree[], normalizedQuery: string): TreeMatch[] {
  if (!normalizedQuery) return [];
  const matches: TreeMatch[] = [];
  function walk(nodes: BomTreeNode[], idPrefix: string) {
    for (const node of nodes) {
      if (nodeMatchesQuery(node, normalizedQuery)) {
        matches.push({ id: `${idPrefix}:${node.path}` });
      }
      walk(node.children, idPrefix);
    }
  }
  for (const tree of subpartTrees) walk(tree.roots, String(tree.bomId));
  return matches;
}

/** Ids of every ancestor of a match (not including the match itself) that
 * needs to be "expanded" for the match to actually be visible on screen —
 * derived by walking the "/"-joined path prefixes encoded in the match id
 * itself (`${idPrefix}:${path}`). */
function ancestorIdsOf(matchId: string): string[] {
  const sep = matchId.indexOf(":");
  const idPrefix = matchId.slice(0, sep);
  const path = matchId.slice(sep + 1);
  const parts = path.split("/");
  const ids: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    ids.push(`${idPrefix}:${parts.slice(0, i).join("/")}`);
  }
  return ids;
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
  const [query, setQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);

  const normalizedQuery = normalizeSearchText(query);
  const matches = useMemo(
    () => collectMatches(subpartTrees, normalizedQuery),
    [subpartTrees, normalizedQuery]
  );

  // Resetting activeMatchIndex and expanding every match's ancestors when
  // the match set changes are both state derived from a render-time value,
  // not a side effect — done during render itself (React's recommended
  // pattern for this: https://react.dev/learn/you-might-not-need-an-effect
  // "Adjusting state when a prop changes"), not in a useEffect. Expanding
  // ancestors up front means stepping through with Prev/Next never needs to
  // re-expand anything.
  const [matchesForIndex, setMatchesForIndex] = useState(matches);
  if (matches !== matchesForIndex) {
    setMatchesForIndex(matches);
    setActiveMatchIndex(0);
    if (matches.length > 0) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        for (const m of matches) {
          for (const id of ancestorIdsOf(m.id)) next.add(id);
        }
        return next;
      });
    }
  }
  const activeMatch = matches[matches === matchesForIndex ? activeMatchIndex : 0] ?? null;

  useEffect(() => {
    fetchMachineGroups(getSupabase())
      .then(({ machineGroups }) => setMachineGroups(machineGroups))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setListLoading(false));
  }, []);

  // Scroll the active match into view. Depends on expandedIds too, since a
  // freshly-expanded match's row doesn't exist in the DOM until that state
  // update above has actually re-rendered.
  useEffect(() => {
    if (!activeMatch) return;
    const raf = requestAnimationFrame(() => {
      document.getElementById(`bom-row-${activeMatch.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeMatch, expandedIds]);

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

  function goToNext() {
    if (matches.length === 0) return;
    setActiveMatchIndex((i) => (i + 1) % matches.length);
  }

  function goToPrev() {
    if (matches.length === 0) return;
    setActiveMatchIndex((i) => (i - 1 + matches.length) % matches.length);
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
          <>
            <div className="bg-background sticky top-0 z-10 mb-3 flex items-center gap-2 border-b py-3">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  if (e.shiftKey) goToPrev();
                  else goToNext();
                }}
                placeholder="Search part no. / description…"
                className="flex-1"
              />
              <span className="text-muted-foreground w-16 shrink-0 text-center text-sm whitespace-nowrap">
                {query.trim() ? `${matches.length > 0 ? activeMatchIndex + 1 : 0} / ${matches.length}` : ""}
              </span>
              <Button
                size="icon"
                variant="outline"
                onClick={goToPrev}
                disabled={matches.length === 0}
                aria-label="Previous match"
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                onClick={goToNext}
                disabled={matches.length === 0}
                aria-label="Next match"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>

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
          </>
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
                        normalizedQuery={normalizedQuery}
                        activeMatchId={activeMatch?.id ?? null}
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
