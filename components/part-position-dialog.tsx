"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ancestorIdsOf } from "@/components/bom-structure-viewer";
import { BomTreeNodeRow } from "@/components/bom-tree-node";
import { buildBomTree, type BomTreeItem, type BomTreeNode } from "@/lib/bom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTranslate } from "@/lib/i18n";

const zh: Record<string, string> = {
  " — machine {machine}": " — 機台 {machine}",
  "Match {current} / {total}": "第 {current} / {total} 筆符合",
  "Previous match": "上一筆",
  "Next match": "下一筆",
  "Loading…": "載入中…",
  "Full BOM": "完整 BOM",
  "Not found in Full BOM": "在完整 BOM 中找不到",
  Modules: "模組",
  "Not found in any module": "在任何模組中都找不到",
};

export interface PartPositionTarget {
  partNo: string;
  description: string | null;
  machine: string;
}

/** Every node in `roots` whose part_no exactly matches, in tree walk
 * (pre)order — the id scheme (idPrefix plus "/"-joined node.path) plugs
 * directly into ancestorIdsOf for auto-expanding the tree down to each
 * match, and the walk order gives Prev/Next a sensible top-to-bottom
 * sequence. */
function collectExactMatchIds(roots: BomTreeNode[], idPrefix: string, partNo: string): string[] {
  const ids: string[] = [];
  function walk(nodes: BomTreeNode[]) {
    for (const node of nodes) {
      if (node.item.part_no === partNo) ids.push(`${idPrefix}:${node.path}`);
      walk(node.children);
    }
  }
  walk(roots);
  return ids;
}

/**
 * "Where is this part?" dialog — shared by the BOM Comparison Tool (Only in
 * A/B rows) and the Key Parts Fingerprint page. `mode` controls which
 * source(s) get fetched and shown: "fullBom"/"modules" match a single
 * comparison run's mode (comparison tool), "both" shows both sections
 * (fingerprint, which has no single active mode).
 */
export function PartPositionDialog({
  open,
  onOpenChange,
  target,
  mode,
  getFullBomTree,
  getModules,
  getModuleTree,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: PartPositionTarget | null;
  mode: "modules" | "fullBom" | "both";
  getFullBomTree: (machine: string) => Promise<BomTreeItem[]>;
  getModules: (machine: string) => Promise<{ bomId: number; sourceFile: string }[]>;
  getModuleTree: (bomId: number, sourceFile: string) => Promise<BomTreeItem[]>;
}) {
  const t = useTranslate(zh);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullBomItems, setFullBomItems] = useState<BomTreeItem[] | null>(null);
  const [moduleItems, setModuleItems] = useState<{ bomId: number; sourceFile: string; items: BomTreeItem[] }[] | null>(
    null
  );
  // Expand/collapse state the user sets by clicking a chevron inside the
  // dialog's tree — separate from the auto-expanded ancestor chain (below)
  // so toggling one node doesn't fight with the auto-expansion on re-render.
  const [manualExpandedIds, setManualExpandedIds] = useState<Set<string>>(new Set());
  // Which of `matches` (below) is currently scrolled-to/highlighted —
  // cycled by the Prev/Next buttons, shown only when a part occurs more
  // than once (the same part can legitimately appear under more than one
  // parent, or in more than one module).
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open || !target) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFullBomItems(null);
    setModuleItems(null);
    setManualExpandedIds(new Set());
    setActiveIndex(0);

    (async () => {
      try {
        // Only fetch whichever data source is actually needed — Full BOM
        // mode never needs the per-module trees and vice versa, and each is
        // a paginated fetch of potentially 20k+ rows.
        const tasks: Promise<unknown>[] = [];
        if (mode === "fullBom" || mode === "both") {
          tasks.push(
            getFullBomTree(target.machine).then((items) => {
              if (!cancelled) setFullBomItems(items);
            })
          );
        }
        if (mode === "modules" || mode === "both") {
          tasks.push(
            (async () => {
              const modules = await getModules(target.machine);
              const results = await Promise.all(
                modules.map(async (m) => ({
                  bomId: m.bomId,
                  sourceFile: m.sourceFile,
                  items: await getModuleTree(m.bomId, m.sourceFile),
                }))
              );
              if (!cancelled) {
                setModuleItems(results.filter((m) => m.items.some((i) => i.part_no === target.partNo)));
              }
            })()
          );
        }
        await Promise.all(tasks);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target?.partNo, target?.machine, mode]);

  function toggleExpanded(id: string) {
    setManualExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const fullBomView = useMemo(() => {
    if (!fullBomItems || !target) return null;
    const roots = buildBomTree(fullBomItems);
    const matchIds = collectExactMatchIds(roots, "fullbom", target.partNo);
    return { roots, matchIds };
  }, [fullBomItems, target]);

  const moduleTrees = useMemo(() => {
    if (!moduleItems || !target) return [];
    return moduleItems.map((m) => {
      const roots = buildBomTree(m.items);
      const matchIds = collectExactMatchIds(roots, String(m.bomId), target.partNo);
      return { bomId: m.bomId, sourceFile: m.sourceFile, roots, matchIds };
    });
  }, [moduleItems, target]);

  const showFullBom = mode === "fullBom" || mode === "both";
  const showModules = mode === "modules" || mode === "both";

  const matches = useMemo(() => {
    const fullBomMatches = showFullBom ? (fullBomView?.matchIds ?? []) : [];
    const moduleMatches = showModules ? moduleTrees.flatMap((m) => m.matchIds) : [];
    return [...fullBomMatches, ...moduleMatches];
  }, [showFullBom, showModules, fullBomView, moduleTrees]);

  const activeMatchId = matches[activeIndex] ?? null;

  const autoExpandedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of matches) for (const ancestorId of ancestorIdsOf(id)) ids.add(ancestorId);
    return ids;
  }, [matches]);

  const expandedIds = useMemo(
    () => new Set([...autoExpandedIds, ...manualExpandedIds]),
    [autoExpandedIds, manualExpandedIds]
  );

  function goToPrevMatch() {
    if (matches.length === 0) return;
    setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
  }

  function goToNextMatch() {
    if (matches.length === 0) return;
    setActiveIndex((i) => (i + 1) % matches.length);
  }

  // Scroll the active match into view — depends on expandedIds too, since a
  // freshly-expanded match's row doesn't exist in the DOM until that state
  // has actually re-rendered.
  useEffect(() => {
    if (!activeMatchId) return;
    const raf = requestAnimationFrame(() => {
      document.getElementById(`bom-row-${activeMatchId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeMatchId, expandedIds]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{target?.partNo}</DialogTitle>
          <DialogDescription>
            {target?.description ?? "-"}
            {t(" — machine {machine}").replace("{machine}", target?.machine ?? "")}
          </DialogDescription>
        </DialogHeader>

        {matches.length > 1 && (
          <div className="flex shrink-0 items-center gap-2 border-b pb-3 text-sm">
            <span className="text-muted-foreground">
              {t("Match {current} / {total}")
                .replace("{current}", String(activeIndex + 1))
                .replace("{total}", String(matches.length))}
            </span>
            <Button size="icon" variant="outline" className="h-7 w-7" onClick={goToPrevMatch} aria-label={t("Previous match")}>
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="outline" className="h-7 w-7" onClick={goToNextMatch} aria-label={t("Next match")}>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>
        )}

        <div className="min-h-0 overflow-y-auto">
          {loading ? (
            <p className="text-muted-foreground text-sm">{t("Loading…")}</p>
          ) : error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : (
            <div className="grid gap-4">
              {showFullBom && (
                <div>
                  <p className="mb-1.5 text-sm font-medium">{t("Full BOM")}</p>
                  {fullBomView && fullBomView.matchIds.length > 0 ? (
                    <Card>
                      <CardContent>
                        {fullBomView.roots.map((root) => (
                          <BomTreeNodeRow
                            key={root.path}
                            node={root}
                            idPrefix="fullbom"
                            expandedPaths={expandedIds}
                            onToggle={toggleExpanded}
                            normalizedQuery=""
                            activeMatchId={activeMatchId}
                          />
                        ))}
                      </CardContent>
                    </Card>
                  ) : (
                    <p className="text-muted-foreground text-sm italic">{t("Not found in Full BOM")}</p>
                  )}
                </div>
              )}
              {showModules && (
                <div>
                  <p className="mb-1.5 text-sm font-medium">{t("Modules")}</p>
                  {moduleTrees.length > 0 ? (
                    <div className="grid gap-3">
                      {moduleTrees.map((m) => (
                        <Card key={m.bomId}>
                          <CardContent>
                            <p className="mb-1.5 text-sm font-medium">{m.sourceFile}</p>
                            {m.roots.map((root) => (
                              <BomTreeNodeRow
                                key={root.path}
                                node={root}
                                idPrefix={String(m.bomId)}
                                expandedPaths={expandedIds}
                                onToggle={toggleExpanded}
                                normalizedQuery=""
                                activeMatchId={activeMatchId}
                              />
                            ))}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm italic">{t("Not found in any module")}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
