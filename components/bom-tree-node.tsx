"use client";

import { ChevronRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { openKmMatrix } from "@/lib/km-matrix";
import type { BomTreeNode } from "@/lib/bom";
import { Button } from "@/components/ui/button";
import { InventoryLookupButton } from "@/components/inventory-lookup-button";

export function normalizeSearchText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

export function nodeMatchesQuery(node: BomTreeNode, normalizedQuery: string): boolean {
  if (!normalizedQuery) return false;
  return (
    normalizeSearchText(node.item.part_no).includes(normalizedQuery) ||
    normalizeSearchText(node.item.description ?? "").includes(normalizedQuery)
  );
}

/**
 * Locates where `normalizedQuery` falls inside `original`, accounting for
 * whitespace stripped out during normalization — normalization only drops
 * whitespace and lowercases (both 1:1, order-preserving operations on the
 * remaining characters), so this walks `original` once, skipping whitespace,
 * to build a normalized-index -> original-index map, then maps the found
 * match's start/end back to real offsets into `original` for highlighting.
 */
function findHighlightRange(original: string, normalizedQuery: string): [number, number] | null {
  if (!normalizedQuery) return null;
  const indexMap: number[] = [];
  let normalized = "";
  for (let i = 0; i < original.length; i++) {
    const ch = original[i];
    if (/\s/.test(ch)) continue;
    normalized += ch.toLowerCase();
    indexMap.push(i);
  }
  const idx = normalized.indexOf(normalizedQuery);
  if (idx === -1) return null;
  const start = indexMap[idx];
  const end = indexMap[idx + normalizedQuery.length - 1] + 1;
  return [start, end];
}

function HighlightedText({ text, normalizedQuery }: { text: string; normalizedQuery: string }) {
  const range = normalizedQuery ? findHighlightRange(text, normalizedQuery) : null;
  if (!range) return <>{text}</>;
  const [start, end] = range;
  return (
    <>
      {text.slice(0, start)}
      <mark className="bg-yellow-300 text-black">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

/**
 * One row of a BOM hierarchy, rendered recursively. Collapsed nodes don't
 * mount their children at all (not just hidden via CSS), so a large BOM
 * with thousands of items stays cheap to render as long as it's mostly
 * collapsed.
 *
 * `idPrefix` disambiguates expand/collapse state between sibling BOM trees
 * (e.g. a machine's separate module subparts) that could otherwise contain
 * a node at the same relative path — the tree structure itself
 * (`node.path`) is scoped to one subpart's rows, but the shared
 * `expandedPaths` set spans every subpart shown on the page at once.
 *
 * Each row carries a `bom-row-<id>` DOM id so the search feature can scroll
 * a specific match into view via document.getElementById.
 */
export function BomTreeNodeRow({
  node,
  idPrefix,
  expandedPaths,
  onToggle,
  normalizedQuery,
  activeMatchId,
}: {
  node: BomTreeNode;
  idPrefix: string;
  expandedPaths: Set<string>;
  onToggle: (id: string) => void;
  normalizedQuery: string;
  activeMatchId: string | null;
}) {
  const id = `${idPrefix}:${node.path}`;
  const expanded = expandedPaths.has(id);
  const hasChildren = node.children.length > 0;
  const isActiveMatch = id === activeMatchId;

  return (
    <div>
      <div className="flex items-center">
        <button
          id={`bom-row-${id}`}
          type="button"
          className={cn(
            "hover:bg-accent flex min-w-0 flex-1 items-center gap-1.5 rounded-sm py-1 pr-2 text-left text-sm",
            isActiveMatch && "ring-2 ring-orange-500"
          )}
          style={{ paddingLeft: `${node.item.level * 1.25 + 0.25}rem` }}
          onClick={() => hasChildren && onToggle(id)}
        >
          {hasChildren ? (
            <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", expanded && "rotate-90")} />
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          <span className="shrink-0 font-mono text-xs">
            <HighlightedText text={node.item.part_no} normalizedQuery={normalizedQuery} />
          </span>
          <span className="text-muted-foreground truncate">
            <HighlightedText text={node.item.description ?? ""} normalizedQuery={normalizedQuery} />
          </span>
          <span className="text-muted-foreground ml-auto shrink-0 pl-2 text-xs whitespace-nowrap">
            {node.item.qty ?? "-"} {node.item.uom ?? ""}
          </span>
        </button>
        {/* Sibling of the button above, not nested inside it — a real
         * <button> can't contain another <button> (invalid HTML, breaks
         * hydration). Scoped to its own row here (not the outer div) so
         * it lays out next to the row's own button without also pulling
         * the children container below into the same flex row. */}
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground shrink-0"
          onClick={() => openKmMatrix(node.item.part_no)}
        >
          <ExternalLink className="h-3 w-3" />
          KM
        </Button>
        <InventoryLookupButton partNo={node.item.part_no} className="text-muted-foreground mr-2 shrink-0" />
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <BomTreeNodeRow
              key={child.path}
              node={child}
              idPrefix={idPrefix}
              expandedPaths={expandedPaths}
              onToggle={onToggle}
              normalizedQuery={normalizedQuery}
              activeMatchId={activeMatchId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
