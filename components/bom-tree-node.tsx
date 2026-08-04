"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BomTreeNode } from "@/lib/bom";

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
 */
export function BomTreeNodeRow({
  node,
  idPrefix,
  expandedPaths,
  onToggle,
}: {
  node: BomTreeNode;
  idPrefix: string;
  expandedPaths: Set<string>;
  onToggle: (id: string) => void;
}) {
  const id = `${idPrefix}:${node.path}`;
  const expanded = expandedPaths.has(id);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <button
        type="button"
        className="hover:bg-accent flex w-full items-center gap-1.5 rounded-sm py-1 pr-2 text-left text-sm"
        style={{ paddingLeft: `${node.item.level * 1.25 + 0.25}rem` }}
        onClick={() => hasChildren && onToggle(id)}
      >
        {hasChildren ? (
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", expanded && "rotate-90")} />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="shrink-0 font-mono text-xs">{node.item.part_no}</span>
        <span className="text-muted-foreground truncate">{node.item.description ?? ""}</span>
        <span className="text-muted-foreground ml-auto shrink-0 pl-2 text-xs whitespace-nowrap">
          {node.item.qty ?? "-"} {node.item.uom ?? ""}
        </span>
      </button>
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <BomTreeNodeRow key={child.path} node={child} idPrefix={idPrefix} expandedPaths={expandedPaths} onToggle={onToggle} />
          ))}
        </div>
      )}
    </div>
  );
}
