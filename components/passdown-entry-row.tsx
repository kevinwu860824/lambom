"use client";

import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import {
  SHIFT_LABELS,
  STATUS_LABELS,
  type PassdownShift,
  type PassdownStatus,
  type PassdownUpdate,
} from "@/lib/passdown";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EditableField } from "@/components/editable-field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

export function PassdownEntryRow({
  entry,
  updates,
  currentShift,
  onStatusChange,
  onFieldSave,
  onAddNote,
}: {
  entry: PassdownRowEntry;
  updates: PassdownUpdate[];
  currentShift: PassdownShift;
  onStatusChange: (status: PassdownStatus) => Promise<void>;
  onFieldSave: (field: "problemStatement" | "remark", value: string) => Promise<void>;
  onAddNote: (note: string) => Promise<void>;
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
      <TableCell className="min-w-48 max-w-72 align-top whitespace-normal">
        <EditableField value={entry.problemStatement ?? ""} onSave={(v) => onFieldSave("problemStatement", v)} />
      </TableCell>
      <TableCell className="min-w-56 max-w-80 align-top whitespace-normal">
        <div className="space-y-1">
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
        </div>
      </TableCell>
      <TableCell className="min-w-40 max-w-64 align-top whitespace-normal">
        <EditableField value={entry.remark ?? ""} onSave={(v) => onFieldSave("remark", v)} />
      </TableCell>
      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
        {entry.isPlaceholder ? <Badge variant="outline">沿用上次</Badge> : entry.updatedByName || "-"}
      </TableCell>
    </TableRow>
  );
}
