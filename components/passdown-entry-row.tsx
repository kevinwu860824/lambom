"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, Copy, History, MessageSquarePlus } from "lucide-react";
import {
  SHIFT_LABELS,
  STATUS_LABELS,
  type PassdownShift,
  type PassdownStatus,
  type PassdownUpdate,
  type ProblemHistoryNote,
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

const STATUS_BADGE_CLASS: Record<PassdownStatus, string> = {
  up: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  down: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  monitor: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  other: "bg-secondary text-secondary-foreground",
};

const STATUS_OPTIONS: PassdownStatus[] = ["up", "down", "monitor", "other"];

// Shared box treatment (border/radius/padding/shadow) so Problem Statement,
// Activities & Planning, and Remark all read as the same kind of cell,
// whether their content is an editable textarea or the note-log + add-note
// control.
const CELL_BOX = "min-h-[38px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs";
const CELL_WIDTH = "min-w-56 max-w-80";

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
function EditableTextCell({ value, onSave }: { value: string; onSave: (value: string) => Promise<void> }) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.minHeight = "0px";
    el.style.minHeight = `${el.scrollHeight}px`;
  }, [draft]);

  async function commit() {
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
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
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
  onFetchHistory,
  onCopyToNote,
}: {
  value: string;
  toolId: string;
  onSave: (value: string) => Promise<void>;
  onSearchSimilar: (searchText: string, toolId: string) => Promise<SimilarProblem[]>;
  onFetchHistory: (target: { toolId: string; module: string; problemStatement: string }) => Promise<ProblemHistoryNote[]>;
  onCopyToNote: (text: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<SimilarProblem | null>(null);
  const [historyNotes, setHistoryNotes] = useState<ProblemHistoryNote[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.minHeight = "0px";
    el.style.minHeight = `${el.scrollHeight}px`;
  }, [draft]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (draft === lastPickedValueRef.current) {
      return;
    }
    const trimmed = draft.trim();
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

  async function commit(text: string) {
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

  async function pickSuggestion(s: SimilarProblem) {
    setSuggestOpen(false);
    setSuggestions([]);
    lastPickedValueRef.current = s.problemStatement;
    setDraft(s.problemStatement);
    await commit(s.problemStatement);

    setHistoryTarget(s);
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryError(null);
    setHistoryNotes(null);
    try {
      const notes = await onFetchHistory({
        toolId: s.toolId,
        module: s.module,
        problemStatement: s.problemStatement,
      });
      setHistoryNotes(notes);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : String(err));
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <div className="h-full">
      <Popover open={suggestOpen} onOpenChange={setSuggestOpen}>
        <PopoverAnchor asChild>
          <Textarea
            ref={textareaRef}
            value={draft}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(draft)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setDraft(value);
                setSuggestOpen(false);
                e.currentTarget.blur();
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
          <p className="text-muted-foreground mb-1.5 px-1 text-xs font-medium">
            {suggestLoading ? "搜尋中..." : "過去可能發生過的類似問題"}
          </p>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => pickSuggestion(s)}
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
                </div>
                <p className="text-foreground line-clamp-2 whitespace-pre-wrap">{s.problemStatement}</p>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {error && <p className="text-destructive mt-1 text-xs">{error}</p>}

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-4 w-4" />
              上次怎麼處理
            </DialogTitle>
            <DialogDescription>
              {historyTarget?.toolId} / {historyTarget?.module} — {historyTarget?.problemStatement}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto">
            {historyLoading ? (
              <p className="text-muted-foreground text-sm">載入中...</p>
            ) : historyError ? (
              <p className="text-destructive text-sm">{historyError}</p>
            ) : !historyNotes || historyNotes.length === 0 ? (
              <p className="text-muted-foreground text-sm italic">這個問題沒有留下交接留言紀錄。</p>
            ) : (
              <ul className="space-y-2">
                {historyNotes.map(({ note, entryDate }) => (
                  <li key={note.id} className="bg-muted/50 rounded-md p-2.5 text-sm">
                    <div className="text-muted-foreground mb-1 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3" />
                        {entryDate}
                        <span className="font-medium text-foreground">{note.personName ?? "未知"}</span>
                        {note.shift && <Badge variant="outline">{SHIFT_LABELS[note.shift]}</Badge>}
                      </span>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-muted-foreground shrink-0"
                        onClick={() => onCopyToNote(note.note)}
                      >
                        <Copy className="h-3 w-3" />
                        複製進今天留言
                      </Button>
                    </div>
                    <p className="whitespace-pre-wrap">{note.note}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
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
  }) => Promise<ProblemHistoryNote[]>;
}) {
  const [statusSaving, setStatusSaving] = useState(false);
  const [note, setNote] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [notePopoverOpen, setNotePopoverOpen] = useState(false);

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
          onFetchHistory={onFetchProblemHistory}
          onCopyToNote={copyToNoteDraft}
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
          <Popover open={notePopoverOpen} onOpenChange={setNotePopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="xs" className="text-muted-foreground -ml-2">
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
        </div>
      </TableCell>
      <TableCell className={cn(CELL_WIDTH, "align-top whitespace-normal")}>
        <EditableTextCell value={entry.remark ?? ""} onSave={(v) => onFieldSave("remark", v)} />
      </TableCell>
      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
        {entry.isPlaceholder ? <Badge variant="outline">沿用上次</Badge> : entry.updatedByName || "-"}
      </TableCell>
    </TableRow>
  );
}
