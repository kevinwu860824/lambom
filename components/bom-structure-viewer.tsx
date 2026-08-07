"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, ChevronUp } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { buildBomTree, documentPartCodeFor, DOCUMENT_PART_PREFIXES, type BomTreeItem, type BomTreeNode } from "@/lib/bom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BomTreeNodeRow, nodeMatchesQuery, normalizeSearchText } from "@/components/bom-tree-node";
import { DocumentPartsFilter } from "@/components/document-parts-filter";

type SupabaseClient = ReturnType<typeof createClient>;

export interface BomStructureSubpart {
  bomId: number;
  sourceFile: string;
  items: BomTreeItem[];
}

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
 * itself (`${idPrefix}:${path}`). Only ancestors, never the match's own
 * descendants — finding a part shouldn't blow open everything beneath it.
 * Exported for reuse by the Comparison Tool's "where is this part" dialog,
 * which auto-expands a found part's ancestor chain the same way. */
export function ancestorIdsOf(matchId: string): string[] {
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

/**
 * Shared machine -> hierarchical parts tree viewer with search/expand-
 * collapse/document-parts filtering — used by both the Modules-based BOM
 * Structure Viewer (/tree, one subpart per module file) and the Full BOM
 * viewer (/full-bom, always exactly one subpart per machine). The caller
 * supplies how to fetch the machine list and, per machine, its list of
 * subparts (each already carrying its own flat item rows) — everything
 * else (tree building, search, highlighting, expand state) is identical
 * regardless of what "a subpart" means for the caller's data.
 */
export function BomStructureViewer({
  title,
  description,
  fetchMachineNames,
  fetchSubparts,
}: {
  title: string;
  description: string;
  fetchMachineNames: (supabase: SupabaseClient) => Promise<string[]>;
  /**
   * `onProgress` is optional to call — a caller whose data always arrives
   * in one shot (e.g. Modules, where each subpart is small) can just
   * ignore it and return the final array. A caller reading a large,
   * slow-to-fully-load dataset (e.g. Full BOM, tens of thousands of rows)
   * can call it repeatedly with the best-known-so-far subpart list as data
   * streams in, so the tree renders progressively instead of staying
   * blank until everything has loaded.
   */
  fetchSubparts: (
    supabase: SupabaseClient,
    machineName: string,
    onProgress: (partial: BomStructureSubpart[]) => void
  ) => Promise<BomStructureSubpart[]>;
}) {
  const supabaseRef = useRef<SupabaseClient | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  const [machineNames, setMachineNames] = useState<string[]>([]);
  const [machine, setMachine] = useState("");
  const [subpartData, setSubpartData] = useState<BomStructureSubpart[]>([]);
  const [selectedSourceFiles, setSelectedSourceFiles] = useState<Set<string>>(new Set());
  const [visibleDocumentCodes, setVisibleDocumentCodes] = useState<Set<string>>(new Set());
  const [listLoading, setListLoading] = useState(true);
  const [treeLoading, setTreeLoading] = useState(false);
  const [streamingMore, setStreamingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rebuilt whenever visibleDocumentCodes changes — filtering the flat
  // items before buildBomTree naturally drops a hidden node's whole
  // subtree too (its children become unreachable from the root during tree
  // construction), not just the node itself.
  const subpartTrees = useMemo<SubpartTree[]>(
    () =>
      subpartData.map((d) => ({
        bomId: d.bomId,
        sourceFile: d.sourceFile,
        roots: buildBomTree(
          d.items.filter((i) => {
            const code = documentPartCodeFor(i.part_no);
            return code === null || visibleDocumentCodes.has(code);
          })
        ),
      })),
    [subpartData, visibleDocumentCodes]
  );
  // Expansion the user asked for explicitly (clicks, Expand/Collapse All,
  // the initial auto-expanded root). Kept separate from search-driven
  // expansion (below) so a new/cleared search never leaves stale branches
  // pinned open, and never touches state the user set themselves.
  const [manualExpandedIds, setManualExpandedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);

  const visibleSubpartTrees = useMemo(
    () => subpartTrees.filter((t) => selectedSourceFiles.has(t.sourceFile)),
    [subpartTrees, selectedSourceFiles]
  );

  const normalizedQuery = normalizeSearchText(query);
  const matches = useMemo(
    () => collectMatches(visibleSubpartTrees, normalizedQuery),
    [visibleSubpartTrees, normalizedQuery]
  );

  // Recomputed fresh from the current match set every time (not merged
  // into manualExpandedIds) — so a branch that matched a previous search
  // but not the current one goes back to whatever it was before, instead
  // of staying pinned open forever.
  const searchExpandedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of matches) {
      for (const id of ancestorIdsOf(m.id)) ids.add(id);
    }
    return ids;
  }, [matches]);

  const expandedIds = useMemo(() => {
    if (searchExpandedIds.size === 0) return manualExpandedIds;
    const merged = new Set(manualExpandedIds);
    for (const id of searchExpandedIds) merged.add(id);
    return merged;
  }, [manualExpandedIds, searchExpandedIds]);

  // Resetting activeMatchIndex when the match set changes is state derived
  // from a render-time value, not a side effect — done during render itself
  // (React's recommended "adjusting state when a value changes" pattern),
  // not in a useEffect. Using activeMatchIndexResolved (rather than the
  // possibly-stale activeMatchIndex state) everywhere below means the
  // counter/scroll are correct even in this same render pass.
  const [matchesForIndex, setMatchesForIndex] = useState(matches);
  if (matches !== matchesForIndex) {
    setMatchesForIndex(matches);
    setActiveMatchIndex(0);
  }
  const activeMatchIndexResolved = matches === matchesForIndex ? activeMatchIndex : 0;
  const activeMatch = matches[activeMatchIndexResolved] ?? null;

  useEffect(() => {
    fetchMachineNames(getSupabase())
      .then(setMachineNames)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setListLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll the active match into view. Depends on expandedIds too, since a
  // freshly-expanded match's row doesn't exist in the DOM until that state
  // has actually re-rendered.
  useEffect(() => {
    if (!activeMatch) return;
    const raf = requestAnimationFrame(() => {
      document.getElementById(`bom-row-${activeMatch.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeMatch, expandedIds]);

  function toggleExpanded(id: string) {
    setManualExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    const all = new Set<string>();
    for (const tree of visibleSubpartTrees) collectExpandablePaths(tree.roots, String(tree.bomId), all);
    setManualExpandedIds(all);
  }

  function collapseAll() {
    setManualExpandedIds(new Set());
  }

  function toggleSubpartSelected(sourceFile: string) {
    setSelectedSourceFiles((prev) => {
      const next = new Set(prev);
      if (next.has(sourceFile)) next.delete(sourceFile);
      else next.add(sourceFile);
      return next;
    });
  }

  function toggleAllSubparts() {
    setSelectedSourceFiles((prev) =>
      prev.size === subpartData.length ? new Set() : new Set(subpartData.map((d) => d.sourceFile))
    );
  }

  function toggleDocumentCode(code: string) {
    setVisibleDocumentCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function toggleAllDocumentCodes() {
    setVisibleDocumentCodes((prev) =>
      prev.size === DOCUMENT_PART_PREFIXES.length ? new Set() : new Set(DOCUMENT_PART_PREFIXES.map((p) => p.code))
    );
  }

  function goToNext() {
    if (matches.length === 0) return;
    setActiveMatchIndex((i) => (i + 1) % matches.length);
  }

  function goToPrev() {
    if (matches.length === 0) return;
    setActiveMatchIndex((i) => (i - 1 + matches.length) % matches.length);
  }

  // Auto-expand just each subpart's root(s) so there's something useful to
  // see immediately without a huge initial render. Built against the
  // current document-parts visibility so it matches what subpartTrees will
  // actually render. Called on every progress update too (not just once at
  // the end) so the root is expanded as soon as it's known, rather than
  // only after a large dataset has fully finished streaming in.
  function expandRootsOf(data: BomStructureSubpart[]) {
    setManualExpandedIds((prev) => {
      const next = new Set(prev);
      for (const d of data) {
        const roots = buildBomTree(
          d.items.filter((i) => {
            const code = documentPartCodeFor(i.part_no);
            return code === null || visibleDocumentCodes.has(code);
          })
        );
        for (const root of roots) {
          if (root.children.length > 0) next.add(`${d.bomId}:${root.path}`);
        }
      }
      return next;
    });
  }

  async function handleMachineChange(value: string) {
    setMachine(value);
    setSubpartData([]);
    setSelectedSourceFiles(new Set());
    setError(null);
    setManualExpandedIds(new Set());
    setTreeLoading(true);
    setStreamingMore(true);
    let gotFirstProgress = false;
    try {
      const data = await fetchSubparts(getSupabase(), value, (partial) => {
        gotFirstProgress = true;
        setTreeLoading(false);
        setSubpartData(partial);
        setSelectedSourceFiles(new Set(partial.map((d) => d.sourceFile)));
        expandRootsOf(partial);
      });
      setSubpartData(data);
      setSelectedSourceFiles(new Set(data.map((d) => d.sourceFile)));
      expandRootsOf(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!gotFirstProgress) setTreeLoading(false);
      setStreamingMore(false);
    }
  }

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-muted-foreground mt-1 text-sm">{description}</p>
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
            </div>

            {subpartTrees.length > 0 && (
              <div className="mt-4 grid gap-1.5">
                <label className="text-sm font-medium">Subparts</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="h-9 w-full justify-between font-normal">
                      <span className="truncate">
                        {selectedSourceFiles.size === 0
                          ? "No subparts selected"
                          : selectedSourceFiles.size === subpartTrees.length
                            ? "All subparts"
                            : `${selectedSourceFiles.size}/${subpartTrees.length} subparts selected`}
                      </span>
                      <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-2">
                    <label className="flex items-center gap-2 border-b pb-1.5 text-sm font-medium">
                      <Checkbox
                        checked={
                          selectedSourceFiles.size === 0
                            ? false
                            : selectedSourceFiles.size === subpartTrees.length
                              ? true
                              : "indeterminate"
                        }
                        onCheckedChange={toggleAllSubparts}
                      />
                      All subparts
                    </label>
                    <div className="mt-1.5 grid max-h-56 gap-1 overflow-y-auto">
                      {subpartTrees.map((tree) => (
                        <label
                          key={tree.sourceFile}
                          className="hover:bg-accent flex items-center gap-2 rounded px-1 py-1 text-sm"
                        >
                          <Checkbox
                            checked={selectedSourceFiles.has(tree.sourceFile)}
                            onCheckedChange={() => toggleSubpartSelected(tree.sourceFile)}
                          />
                          {tree.sourceFile}
                        </label>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <div className="mt-1">
                  <DocumentPartsFilter
                    visibleCodes={visibleDocumentCodes}
                    onToggle={toggleDocumentCode}
                    onToggleAll={toggleAllDocumentCodes}
                  />
                </div>
              </div>
            )}
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
                {query.trim() ? `${matches.length > 0 ? activeMatchIndexResolved + 1 : 0} / ${matches.length}` : ""}
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

        {streamingMore && !treeLoading && (
          <p className="text-muted-foreground mb-3 text-sm">
            Loading more… ({subpartData.reduce((n, d) => n + d.items.length, 0).toLocaleString()} items so far)
          </p>
        )}

        <div className="grid gap-4">
          {visibleSubpartTrees.map((tree) => (
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
