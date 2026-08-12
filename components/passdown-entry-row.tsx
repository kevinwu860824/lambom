"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, Copy, History, MessageSquarePlus, Pencil } from "lucide-react";
import {
  SHIFT_LABELS,
  STATUS_LABELS,
  STATUS_OPTIONS,
  type PassdownShift,
  type PassdownStatus,
  type PassdownUpdate,
  type ProblemHistoryResult,
  type RemoteEditor,
  type SimilarProblem,
} from "@/lib/passdown";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const STATUS_BADGE_CLASS: Record<PassdownStatus, string> = {
  up: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  down: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  monitor: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  t0: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  t1: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  t2: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  other: "bg-secondary text-secondary-foreground",
};

// Shared box treatment (border/radius/padding/shadow) so Problem Statement,
// Activities & Planning, and Remark all read as the same kind of cell,
// whether their content is an editable textarea or the note-log + add-note
// control.
const CELL_BOX = "min-h-[38px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs";
const CELL_WIDTH = "min-w-56 max-w-80";

// Deterministic per-person color (same hashing idea as fingerprint page's
// categoryColor) so the "someone's editing this" border/badge stays the
// same color for the same person across cells/renders, without needing a
// lookup table anyone has to maintain.
const PERSON_BORDER_CLASS = [
  "border-blue-400 dark:border-blue-500",
  "border-emerald-400 dark:border-emerald-500",
  "border-amber-400 dark:border-amber-500",
  "border-violet-400 dark:border-violet-500",
  "border-rose-400 dark:border-rose-500",
  "border-cyan-400 dark:border-cyan-500",
];
const PERSON_BADGE_CLASS = [
  "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
];

function personColorIndex(personId: string): number {
  let hash = 0;
  for (let i = 0; i < personId.length; i++) {
    hash = (hash * 31 + personId.charCodeAt(i)) >>> 0;
  }
  return hash % PERSON_BORDER_CLASS.length;
}

/** Read-only view swapped in for Problem Statement/Remark while Presence
 * says someone else has that cell focused — shows their live-broadcast
 * draft text (falling back to the last known saved value before any
 * broadcast arrives) instead of an editable box, so two people can't type
 * into the same cell at once. */
function RemoteEditingCell({ editor, text }: { editor: RemoteEditor; text: string }) {
  const idx = personColorIndex(editor.personId);
  return (
    <div className={cn(CELL_BOX, "h-full border-2", PERSON_BORDER_CLASS[idx])}>
      <Badge className={cn("mb-1 px-1.5 py-0 text-[10px]", PERSON_BADGE_CLASS[idx])}>
        <Pencil className="h-2.5 w-2.5" />
        {editor.personName} 正在編輯
      </Badge>
      <p className="whitespace-pre-wrap">
        {text || <span className="text-muted-foreground italic">...</span>}
      </p>
    </div>
  );
}

export interface PassdownRowEntry {
  id: number;
  toolId: string;
  product: string | null;
  module: string;
  status: PassdownStatus;
  problemStatement: string | null;
  remark: string | null;
  updatedByName: string | null;
  isPlaceholder?: boolean;
}

/** Textarea-based inline-editable cell, saving on blur — matches how a
 * spreadsheet cell commits when you click away, and keeps this column's
 * multi-line text (most migrated Problem Statement/Remark values have
 * several lines) visible without a separate expand step.
 *
 * Height is min-height driven by its own content (auto-grow, so nothing is
 * ever clipped/scrolled inside this one cell) combined with `h-full` (so it
 * also stretches to match whichever of Problem Statement/Activities &
 * Planning/Remark is tallest in the row — plain HTML table rows already
 * size every cell to the tallest one, this just makes the box fill that
 * height instead of leaving empty space below a shorter box). */
function EditableTextCell({
  value,
  onSave,
  remoteEditor,
  remoteDraftText,
  onFocusCell,
  onBlurCell,
  onDraftChange,
  pendingCopyText,
  pendingCopyNonce,
}: {
  value: string;
  onSave: (value: string) => Promise<void>;
  /** Set when Presence says someone else is focused on this cell — renders
   * a read-only RemoteEditingCell instead, so only one person can type into
   * a given cell at a time. */
  remoteEditor?: RemoteEditor | null;
  remoteDraftText?: string;
  onFocusCell?: () => void;
  onBlurCell?: () => void;
  onDraftChange?: (text: string) => void;
  /** Text to drop into the draft from an external source (the "類似問題"
   * history dialog's "複製到備註" button) — paired with a nonce rather than
   * keyed on the text itself, so copying the exact same text twice in a row
   * still re-triggers the effect below. Not auto-saved: same as typing it
   * by hand, still needs a blur to commit. */
  pendingCopyText?: string;
  pendingCopyNonce?: number;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Escape calls .blur() right after resetting draft, but the blur event
  // fires synchronously — before React has re-rendered with that reset —
  // so onBlur's commit() would otherwise still see (and save) the
  // pre-Escape draft. This ref sidesteps the stale-closure race entirely.
  const isCancellingRef = useRef(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    // Guards against writing into draft while someone else has this cell
    // locked (see the remoteEditor early-return below) — this component's
    // hooks all run before that early return regardless (rules of hooks),
    // so without this the copied text would sit invisibly in local state
    // and only appear once the lock clears, right as it could clobber
    // whatever the other person just saved.
    if (remoteEditor) return;
    if (pendingCopyNonce === undefined || pendingCopyText === undefined) return;
    setDraft(pendingCopyText);
    textareaRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCopyNonce]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.minHeight = "0px";
    el.style.minHeight = `${el.scrollHeight}px`;
  }, [draft]);

  if (remoteEditor) {
    return <RemoteEditingCell editor={remoteEditor} text={remoteDraftText ?? value} />;
  }

  async function commit() {
    if (isCancellingRef.current) {
      isCancellingRef.current = false;
      return;
    }
    const trimmed = draft.trim();
    if (trimmed === (value ?? "")) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDraft(value);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-full">
      <Textarea
        ref={textareaRef}
        value={draft}
        disabled={saving}
        onChange={(e) => {
          setDraft(e.target.value);
          onDraftChange?.(e.target.value);
        }}
        onFocus={onFocusCell}
        onBlur={() => {
          onBlurCell?.();
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            isCancellingRef.current = true;
            setDraft(value);
            e.currentTarget.blur();
          }
        }}
        rows={1}
        className={cn(CELL_BOX, "h-full resize-none overflow-hidden shadow-none")}
      />
      {error && <p className="text-destructive mt-1 text-xs">{error}</p>}
    </div>
  );
}

/** Shared suggestion-list body — used by Problem Statement's type-ahead
 * popover and the "類似問題" buttons on Remark/Activities & Planning.
 * Purely presentational; each caller owns its own Popover open state and
 * anchor, since Problem Statement anchors to its own textarea
 * (PopoverAnchor) while the other two anchor to a plain icon button
 * (PopoverTrigger) — different enough mechanics that forcing one shared
 * Popover wrapper here would be artificial. */
function SimilarProblemsList({
  results,
  loading,
  toolId,
  onPick,
}: {
  results: SimilarProblem[];
  loading: boolean;
  toolId: string;
  onPick: (s: SimilarProblem) => void;
}) {
  return (
    <>
      <p className="text-muted-foreground mb-1.5 px-1 text-xs font-medium">
        {loading ? "搜尋中..." : "過去可能發生過的類似問題"}
      </p>
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {results.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s)}
            className="hover:bg-accent w-full rounded-md p-2 text-left text-xs"
          >
            <div className="text-muted-foreground mb-0.5 flex items-center gap-1.5">
              {s.toolId === toolId ? (
                <Badge variant="secondary" className="px-1 py-0 text-[10px]">
                  同機台
                </Badge>
              ) : (
                <span>
                  {s.toolId} / {s.module}
                </span>
              )}
              <span>{s.entryDate}</span>
              {s.occurrenceCount > 1 && (
                <Badge variant="outline" className="px-1 py-0 text-[10px]">
                  出現過 {s.occurrenceCount} 次
                </Badge>
              )}
            </div>
            <p className="text-foreground line-clamp-2 whitespace-pre-wrap">{s.problemStatement}</p>
            {s.remark && (
              <p className="text-muted-foreground mt-0.5 line-clamp-1 whitespace-pre-wrap">Remark: {s.remark}</p>
            )}
          </button>
        ))}
      </div>
    </>
  );
}

/** Icon button + its own popover, wrapping SimilarProblemsList — the entry
 * point Remark and Activities & Planning use to browse historical entries
 * with a similar Problem Statement (Problem Statement itself already has
 * its own always-on type-ahead version of this, built directly into
 * ProblemStatementCell). Fetches on open rather than as-you-type, since
 * there's no text input driving it here — just a click. */
function SimilarProblemsButton({
  problemStatement,
  toolId,
  excludeEntryId,
  onSearchSimilar,
  onPick,
}: {
  problemStatement: string;
  toolId: string;
  /** The current row's own entry id — excluded from results so this
   * row's own just-saved Problem Statement doesn't show up as a "match"
   * pointing at itself (which, being from today, has no remark/notes yet
   * and just opens an empty history dialog). Not a text-based exclusion
   * like ProblemStatementCell's own suggestion list uses: this button's
   * whole point is finding *other* entries with the same wording (e.g. a
   * recurring "SPM" problem type), so identical text from a different day
   * must still show up — only this exact row is excluded. */
  excludeEntryId?: number;
  onSearchSimilar: (searchText: string, toolId: string) => Promise<SimilarProblem[]>;
  onPick: (s: SimilarProblem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SimilarProblem[]>([]);
  const [loading, setLoading] = useState(false);
  const seqRef = useRef(0);
  const disabled = !problemStatement.trim();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next || disabled) return;
    const seq = ++seqRef.current;
    setLoading(true);
    onSearchSimilar(problemStatement, toolId)
      .then((r) => {
        if (seq === seqRef.current) setResults(r.filter((s) => s.id !== excludeEntryId));
      })
      .catch(() => {
        // Best-effort — a lookup failure just leaves the list empty.
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false);
      });
  }

  // Picking a suggestion opens the (separate, row-level) history dialog —
  // this popover needs to close itself too, or it's left open in state
  // underneath the dialog, and Radix's focus management on the dialog's
  // eventual close can land focus back on whatever's still "open" here.
  function handlePick(s: SimilarProblem) {
    setOpen(false);
    onPick(s);
  }

  return (
    <Tooltip>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <TooltipTrigger asChild>
          <span tabIndex={disabled ? 0 : -1}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="xs" className="text-muted-foreground -ml-2" disabled={disabled}>
                <History className="h-3.5 w-3.5" />
                類似問題
              </Button>
            </PopoverTrigger>
          </span>
        </TooltipTrigger>
        <PopoverContent className="w-80 p-2" align="start">
          <SimilarProblemsList results={results} loading={loading} toolId={toolId} onPick={handlePick} />
        </PopoverContent>
      </Popover>
      {disabled && <TooltipContent>請先填寫 Problem Statement</TooltipContent>}
    </Tooltip>
  );
}

const LINE_NUMBER_PATTERN = /^\s*(\d+)[.)]\s*/;

/**
 * Pressing Enter in the Problem Statement box auto-numbers, so multi-issue
 * entries end up in the "1. .../2. ..." format the per-line similar-problem
 * matching (passdown_search_similar_problems) relies on, instead of relying
 * on everyone remembering to type numbering by hand themselves. If nothing
 * before the cursor is numbered yet, this retroactively numbers every
 * existing non-blank line from 1 before inserting the next number —
 * otherwise it just continues from the highest number already used.
 * Deliberately does NOT renumber anything after the cursor or react to
 * edits/deletions elsewhere in the text — only Enter triggers it, kept
 * simple on purpose.
 */
function applyEnterAutoNumber(text: string, cursor: number): { text: string; cursor: number } {
  const before = text.slice(0, cursor);
  const after = text.slice(cursor);
  const beforeLines = before.split("\n");

  const hasContent = beforeLines.some((line) => line.trim() !== "");
  const allNumbered = beforeLines.every((line) => LINE_NUMBER_PATTERN.test(line) || line.trim() === "");

  let newBefore: string;
  let nextNumber: number;
  if (hasContent && allNumbered) {
    const numbers = beforeLines.map((line) => {
      const m = line.match(LINE_NUMBER_PATTERN);
      return m ? parseInt(m[1], 10) : 0;
    });
    nextNumber = Math.max(...numbers) + 1;
    newBefore = before;
  } else {
    let n = 1;
    newBefore = beforeLines
      .map((line) => {
        if (line.trim() === "") return line;
        const stripped = line.replace(LINE_NUMBER_PATTERN, "");
        return `${n++}. ${stripped}`;
      })
      .join("\n");
    nextNumber = n;
  }

  const insertion = newBefore.length > 0 ? `\n${nextNumber}. ` : `${nextNumber}. `;
  return { text: newBefore + insertion + after, cursor: newBefore.length + insertion.length };
}

/** The single line the cursor is on (numbering included) — used to scope
 * the similar-problem search to just the issue currently being typed,
 * not the whole multi-line draft (which would otherwise search for e.g.
 * "1. SPM\n2. leak" as one blob instead of just "leak"). */
function currentLineText(text: string, cursor: number): string {
  const before = text.slice(0, cursor);
  const after = text.slice(cursor);
  const lineStart = before.lastIndexOf("\n") + 1;
  const nextNewlineInAfter = after.indexOf("\n");
  const lineEnd = cursor + (nextNewlineInAfter === -1 ? after.length : nextNewlineInAfter);
  return text.slice(lineStart, lineEnd);
}

/** Problem Statement cell — same auto-grow/save-on-blur behavior as
 * EditableTextCell, plus a fuzzy-search-as-you-type suggestion list drawn
 * from every past occurrence of a similar problem. Picking one fills the
 * field and opens a read-only "what was done last time" timeline (built
 * from that historical episode's shift notes) with a per-note "copy into
 * today's note" action — never writes anything by itself, so the audit
 * trail stays exactly as trustworthy as manually-typed notes. */
function ProblemStatementCell({
  value,
  toolId,
  onSave,
  onSearchSimilar,
  remoteEditor,
  remoteDraftText,
  onFocusCell,
  onBlurCell,
  onDraftChange,
}: {
  value: string;
  toolId: string;
  onSave: (value: string) => Promise<void>;
  onSearchSimilar: (searchText: string, toolId: string) => Promise<SimilarProblem[]>;
  remoteEditor?: RemoteEditor | null;
  remoteDraftText?: string;
  onFocusCell?: () => void;
  onBlurCell?: () => void;
  onDraftChange?: (text: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Set by the Enter-to-auto-number handler right before setDraft — consumed
  // by the height-resize effect below once the DOM has the new value, since
  // setting selectionStart/End before then would just get overwritten by
  // the controlled <textarea> re-rendering with the old value.
  const pendingCursorRef = useRef<number | null>(null);

  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<SimilarProblem[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeqRef = useRef(0);
  // Tracks the most recent draft value that shouldn't trigger a new search —
  // initialized to the cell's starting value so mounting with pre-existing
  // text never fires a search nobody asked for, and updated to whatever was
  // just picked so accepting a suggestion doesn't immediately reopen a
  // second suggestion list right as the history dialog opens (the picked
  // text is naturally a great match for more suggestions). Comparing
  // against a ref like this — rather than a one-shot "skip the next run"
  // flag — stays correct even under React StrictMode's dev-mode
  // double-invoked effects, which would otherwise consume a one-shot flag
  // on the first invocation and let the second run for real.
  const lastPickedValueRef = useRef<string | null>(value);
  // Same stale-closure guard as EditableTextCell's — Escape's .blur() fires
  // onBlur synchronously, before React re-renders with the just-reset
  // draft, so without this commit() would still save the pre-Escape text.
  const isCancellingRef = useRef(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.minHeight = "0px";
    el.style.minHeight = `${el.scrollHeight}px`;
    if (pendingCursorRef.current !== null) {
      el.selectionStart = el.selectionEnd = pendingCursorRef.current;
      pendingCursorRef.current = null;
    }
  }, [draft]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (draft === lastPickedValueRef.current) {
      return;
    }
    const cursor = textareaRef.current?.selectionStart ?? draft.length;
    const trimmed = currentLineText(draft, cursor).trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setSuggestOpen(false);
      return;
    }
    const seq = ++searchSeqRef.current;
    debounceRef.current = setTimeout(async () => {
      setSuggestLoading(true);
      try {
        const results = await onSearchSimilar(trimmed, toolId);
        if (seq !== searchSeqRef.current) return; // a newer keystroke already superseded this search
        const filtered = results.filter((r) => r.problemStatement.trim() !== value.trim());
        setSuggestions(filtered);
        setSuggestOpen(filtered.length > 0);
      } catch {
        // Suggestions are a convenience — a lookup failure shouldn't block typing/saving.
      } finally {
        if (seq === searchSeqRef.current) setSuggestLoading(false);
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, toolId]);

  if (remoteEditor) {
    return <RemoteEditingCell editor={remoteEditor} text={remoteDraftText ?? value} />;
  }

  async function commit(text: string) {
    if (isCancellingRef.current) {
      isCancellingRef.current = false;
      return;
    }
    const trimmed = text.trim();
    if (trimmed === (value ?? "")) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDraft(value);
    } finally {
      setSaving(false);
    }
  }

  // Replaces just the line the cursor is on (keeping any lines already
  // composed above it, and an already-typed number prefix on that line)
  // with the picked suggestion — not the whole draft. Multi-issue entries
  // are composed one line at a time now (type/pick, Enter for the next
  // auto-numbered line, type/pick again); replacing the entire field on
  // every pick would wipe out every earlier line as soon as a later one
  // was picked.
  async function pickSuggestion(s: SimilarProblem) {
    setSuggestOpen(false);
    setSuggestions([]);
    const el = textareaRef.current;
    const cursor = el ? el.selectionStart : draft.length;
    const before = draft.slice(0, cursor);
    const after = draft.slice(cursor);
    const lastNewline = before.lastIndexOf("\n");
    const linePrefix = before.slice(0, lastNewline + 1);
    const currentLineBeforeCursor = before.slice(lastNewline + 1);
    const numberPrefix = currentLineBeforeCursor.match(LINE_NUMBER_PATTERN)?.[0] ?? "";
    const newDraft = linePrefix + numberPrefix + s.problemStatement + after;

    lastPickedValueRef.current = newDraft;
    setDraft(newDraft);
    await commit(newDraft);
  }

  return (
    <div className="h-full">
      <Popover open={suggestOpen} onOpenChange={setSuggestOpen}>
        <PopoverAnchor asChild>
          <Textarea
            ref={textareaRef}
            value={draft}
            disabled={saving}
            onChange={(e) => {
              setDraft(e.target.value);
              onDraftChange?.(e.target.value);
            }}
            onFocus={onFocusCell}
            onBlur={() => {
              onBlurCell?.();
              commit(draft);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                isCancellingRef.current = true;
                setDraft(value);
                setSuggestOpen(false);
                e.currentTarget.blur();
              } else if (e.key === "Enter") {
                e.preventDefault();
                const { text, cursor } = applyEnterAutoNumber(draft, e.currentTarget.selectionStart);
                pendingCursorRef.current = cursor;
                setDraft(text);
                onDraftChange?.(text);
              }
            }}
            rows={1}
            className={cn(CELL_BOX, "h-full resize-none overflow-hidden shadow-none")}
          />
        </PopoverAnchor>
        <PopoverContent
          className="w-80 p-2"
          align="start"
          // Keep focus on the textarea so typing isn't interrupted by the
          // suggestion list stealing it when it opens.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <SimilarProblemsList results={suggestions} loading={suggestLoading} toolId={toolId} onPick={pickSuggestion} />
        </PopoverContent>
      </Popover>
      {error && <p className="text-destructive mt-1 text-xs">{error}</p>}
    </div>
  );
}

/** The "上次怎麼處理" reference dialog — reused by all three entry points
 * (Problem Statement's suggestion-pick flow, and the "類似問題" buttons on
 * Remark and Activities & Planning), lifted to PassdownEntryRow since
 * Remark/Activities & Planning are siblings of ProblemStatementCell, not
 * descendants, so a shared dialog instance has to live in their common
 * parent. Shows remark and that day's notes together, unconditionally,
 * regardless of which entry point opened it — seeing both together is
 * useful either way (e.g. a maintenance day's measurements alongside which
 * part got swapped). Purely presentational; grouping notes by entryDate
 * happens here rather than in the fetch layer, so presentation-only
 * decisions (like hiding a day with neither remark nor notes) stay easy to
 * change without touching data fetching. */
function ProblemHistoryDialog({
  open,
  onOpenChange,
  target,
  result,
  loading,
  error,
  onCopyNote,
  onCopyRemark,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: SimilarProblem | null;
  result: ProblemHistoryResult | null;
  loading: boolean;
  error: string | null;
  onCopyNote: (text: string) => void;
  onCopyRemark: (text: string) => void;
}) {
  const notesByEntryDate = new Map<string, ProblemHistoryResult["notes"]>();
  for (const n of result?.notes ?? []) {
    const list = notesByEntryDate.get(n.entryDate) ?? [];
    list.push(n);
    notesByEntryDate.set(n.entryDate, list);
  }
  const days = (result?.entries ?? []).filter(
    (e) => e.remark?.trim() || (notesByEntryDate.get(e.entryDate)?.length ?? 0) > 0
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            上次怎麼處理
          </DialogTitle>
          <DialogDescription>
            {target?.toolId} / {target?.module} — {target?.problemStatement}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          {loading ? (
            <p className="text-muted-foreground text-sm">載入中...</p>
          ) : error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : days.length === 0 ? (
            <p className="text-muted-foreground text-sm italic">這個問題沒有留下 Remark 或交接留言紀錄。</p>
          ) : (
            <ul className="space-y-3">
              {days.map((day) => (
                <li key={day.entryId} className="bg-muted/50 rounded-md p-2.5 text-sm">
                  <div className="text-muted-foreground mb-1.5 flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    {day.entryDate}
                  </div>
                  {day.remark?.trim() && (
                    <div className="mb-2 flex items-start justify-between gap-2 rounded bg-background/60 p-1.5">
                      <p className="whitespace-pre-wrap">{day.remark}</p>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-muted-foreground shrink-0"
                        onClick={() => onCopyRemark(day.remark ?? "")}
                      >
                        <Copy className="h-3 w-3" />
                        複製到備註
                      </Button>
                    </div>
                  )}
                  {(notesByEntryDate.get(day.entryDate) ?? []).map(({ note }) => (
                    <div key={note.id} className="mb-1 last:mb-0">
                      <div className="text-muted-foreground mb-1 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5">
                          <span className="font-medium text-foreground">{note.personName ?? "未知"}</span>
                          {note.shift && <Badge variant="outline">{SHIFT_LABELS[note.shift]}</Badge>}
                        </span>
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-muted-foreground shrink-0"
                          onClick={() => onCopyNote(note.note)}
                        >
                          <Copy className="h-3 w-3" />
                          複製進今天留言
                        </Button>
                      </div>
                      <p className="whitespace-pre-wrap">{note.note}</p>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PassdownEntryRow({
  entry,
  updates,
  currentShift,
  onStatusChange,
  onFieldSave,
  onAddNote,
  onSearchSimilarProblems,
  onFetchProblemHistory,
  problemStatementCellKey,
  remarkCellKey,
  remoteFocus,
  remoteDrafts,
  onFocusCell,
  onBlurCell,
  onDraftChange,
}: {
  entry: PassdownRowEntry;
  updates: PassdownUpdate[];
  currentShift: PassdownShift;
  onStatusChange: (status: PassdownStatus) => Promise<void>;
  onFieldSave: (field: "problemStatement" | "remark", value: string) => Promise<void>;
  onAddNote: (note: string) => Promise<void>;
  onSearchSimilarProblems: (searchText: string, toolId: string) => Promise<SimilarProblem[]>;
  onFetchProblemHistory: (target: {
    toolId: string;
    module: string;
    problemStatement: string;
  }) => Promise<ProblemHistoryResult>;
  /** Live co-editing visibility (Presence/Broadcast) — see app/passdown/page.tsx. */
  problemStatementCellKey: string;
  remarkCellKey: string;
  remoteFocus: Map<string, RemoteEditor>;
  remoteDrafts: Map<string, string>;
  onFocusCell: (cellKey: string) => void;
  onBlurCell: () => void;
  onDraftChange: (cellKey: string, text: string) => void;
}) {
  const [statusSaving, setStatusSaving] = useState(false);
  const [note, setNote] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [notePopoverOpen, setNotePopoverOpen] = useState(false);

  // "上次怎麼處理" dialog — lifted here (rather than living inside
  // ProblemStatementCell) since it's now a shared entry point for Remark
  // and Activities & Planning too, both siblings of ProblemStatementCell.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<SimilarProblem | null>(null);
  const [historyResult, setHistoryResult] = useState<ProblemHistoryResult | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  async function openHistory(target: SimilarProblem) {
    setHistoryTarget(target);
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryError(null);
    setHistoryResult(null);
    try {
      setHistoryResult(await onFetchProblemHistory(target));
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : String(err));
    } finally {
      setHistoryLoading(false);
    }
  }

  // "複製到備註" hands historical Remark text to EditableTextCell via a
  // nonce-keyed prop rather than writing straight to entry.remark — same
  // "never auto-save, just pre-fill" rule as copyToNoteDraft below. Nonce
  // starts at undefined, not 0 — EditableTextCell's effect guards on
  // `pendingCopyNonce === undefined` to skip firing on mount, and 0 is a
  // real, distinct value that guard wouldn't catch, which silently focused
  // every row's Remark textarea (and reported it via Presence) on every
  // mount/remount before this was caught.
  const [remarkCopyText, setRemarkCopyText] = useState("");
  const [remarkCopyNonce, setRemarkCopyNonce] = useState<number | undefined>(undefined);
  function copyToRemarkDraft(text: string) {
    setRemarkCopyText(text);
    setRemarkCopyNonce((n) => (n ?? 0) + 1);
  }

  async function handleStatusChange(value: string) {
    setStatusSaving(true);
    try {
      await onStatusChange(value as PassdownStatus);
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleAddNote() {
    const trimmed = note.trim();
    if (!trimmed) return;
    setNoteSaving(true);
    setNoteError(null);
    try {
      await onAddNote(trimmed);
      setNote("");
      setNotePopoverOpen(false);
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : String(err));
    } finally {
      setNoteSaving(false);
    }
  }

  // Lets the Problem Statement history dialog hand a historical note over to
  // the same add-note composer the "留言" button uses, pre-filled as a
  // draft the user can edit before sending — never writes it in directly.
  function copyToNoteDraft(text: string) {
    setNote(text);
    setNotePopoverOpen(true);
  }

  return (
    <TableRow className={cn(entry.isPlaceholder && "bg-muted/30")}>
      <TableCell className="font-medium whitespace-nowrap">{entry.toolId}</TableCell>
      <TableCell className="text-muted-foreground whitespace-nowrap">{entry.product || "-"}</TableCell>
      <TableCell className="whitespace-nowrap">{entry.module}</TableCell>
      <TableCell>
        <Select value={entry.status} onValueChange={handleStatusChange} disabled={statusSaving}>
          <SelectTrigger size="sm" className={cn("w-28 border-transparent font-medium", STATUS_BADGE_CLASS[entry.status])}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className={cn(CELL_WIDTH, "align-top whitespace-normal")}>
        <ProblemStatementCell
          value={entry.problemStatement ?? ""}
          toolId={entry.toolId}
          onSave={(v) => onFieldSave("problemStatement", v)}
          onSearchSimilar={onSearchSimilarProblems}
          remoteEditor={remoteFocus.get(problemStatementCellKey)}
          remoteDraftText={remoteDrafts.get(problemStatementCellKey)}
          onFocusCell={() => onFocusCell(problemStatementCellKey)}
          onBlurCell={onBlurCell}
          onDraftChange={(text) => onDraftChange(problemStatementCellKey, text)}
        />
        <ProblemHistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          target={historyTarget}
          result={historyResult}
          loading={historyLoading}
          error={historyError}
          onCopyNote={copyToNoteDraft}
          onCopyRemark={copyToRemarkDraft}
        />
      </TableCell>
      <TableCell className={cn(CELL_WIDTH, "align-top whitespace-normal")}>
        <div className={cn(CELL_BOX, "h-full space-y-1.5")}>
          {updates.map((u) => (
            <div key={u.id} className="bg-muted/50 rounded p-1.5 text-xs">
              <div className="text-muted-foreground mb-0.5 flex items-center gap-1">
                <span className="text-foreground font-medium">{u.personName ?? "未知"}</span>
                {u.shift && <Badge variant="outline">{SHIFT_LABELS[u.shift]}</Badge>}
              </div>
              <p className="whitespace-pre-wrap">{u.note}</p>
            </div>
          ))}
          <div className="-ml-2 flex items-center">
            <Popover open={notePopoverOpen} onOpenChange={setNotePopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="xs" className="text-muted-foreground">
                  <MessageSquarePlus className="h-3.5 w-3.5" />
                  留言
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72">
                <Textarea
                  placeholder={`新增交接留言(${SHIFT_LABELS[currentShift]})...`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={noteSaving}
                  className="min-h-[70px] text-sm"
                  autoFocus
                />
                <div className="mt-2 flex items-center gap-2">
                  <Button size="sm" onClick={handleAddNote} disabled={noteSaving || !note.trim()}>
                    送出
                  </Button>
                  {noteError && <span className="text-destructive text-xs">{noteError}</span>}
                </div>
              </PopoverContent>
            </Popover>
            <SimilarProblemsButton
              problemStatement={entry.problemStatement ?? ""}
              toolId={entry.toolId}
              excludeEntryId={entry.id}
              onSearchSimilar={onSearchSimilarProblems}
              onPick={openHistory}
            />
          </div>
        </div>
      </TableCell>
      <TableCell className={cn(CELL_WIDTH, "align-top whitespace-normal")}>
        <div className="mb-1 -ml-2">
          <SimilarProblemsButton
            problemStatement={entry.problemStatement ?? ""}
            toolId={entry.toolId}
            excludeEntryId={entry.id}
            onSearchSimilar={onSearchSimilarProblems}
            onPick={openHistory}
          />
        </div>
        <EditableTextCell
          value={entry.remark ?? ""}
          onSave={(v) => onFieldSave("remark", v)}
          remoteEditor={remoteFocus.get(remarkCellKey)}
          remoteDraftText={remoteDrafts.get(remarkCellKey)}
          onFocusCell={() => onFocusCell(remarkCellKey)}
          onBlurCell={onBlurCell}
          onDraftChange={(text) => onDraftChange(remarkCellKey, text)}
          pendingCopyText={remarkCopyText}
          pendingCopyNonce={remarkCopyNonce}
        />
      </TableCell>
      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
        {entry.isPlaceholder ? <Badge variant="outline">沿用上次</Badge> : entry.updatedByName || "-"}
      </TableCell>
    </TableRow>
  );
}
