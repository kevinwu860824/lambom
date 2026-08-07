"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import {
  SHIFT_LABELS,
  STATUS_LABELS,
  type PassdownEntry,
  type PassdownShift,
  type PassdownStatus,
  type PassdownUpdate,
} from "@/lib/passdown";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EditableField } from "@/components/editable-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const STATUS_BADGE_CLASS: Record<PassdownStatus, string> = {
  up: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  down: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  monitor: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  other: "bg-secondary text-secondary-foreground",
};

const STATUS_OPTIONS: PassdownStatus[] = ["up", "down", "monitor", "other"];

export function PassdownEntryCard({
  entry,
  updates,
  canEdit,
  currentShift,
  onStatusChange,
  onFieldSave,
  onAddNote,
}: {
  entry: PassdownEntry;
  updates: PassdownUpdate[];
  canEdit: boolean;
  currentShift: PassdownShift;
  onStatusChange: (status: PassdownStatus) => Promise<void>;
  onFieldSave: (field: "problemStatement" | "remark", value: string) => Promise<void>;
  onAddNote: (note: string) => Promise<void>;
}) {
  const [statusSaving, setStatusSaving] = useState(false);
  const [note, setNote] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

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
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : String(err));
    } finally {
      setNoteSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{entry.module}</span>
            {entry.product && <span className="text-muted-foreground text-xs">{entry.product}</span>}
          </div>
          <div className="text-muted-foreground mt-0.5 text-xs">
            {entry.updatedByName ? `最後更新: ${entry.updatedByName}` : "尚未更新"}
          </div>
        </div>
        {canEdit ? (
          <Select value={entry.status} onValueChange={handleStatusChange} disabled={statusSaving}>
            <SelectTrigger size="sm" className="w-28">
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
        ) : (
          <Badge className={cn(STATUS_BADGE_CLASS[entry.status])}>{STATUS_LABELS[entry.status]}</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="text-muted-foreground mb-1 text-xs font-medium">Problem Statement</div>
          {canEdit ? (
            <EditableField
              value={entry.problemStatement ?? ""}
              onSave={(v) => onFieldSave("problemStatement", v)}
            />
          ) : (
            <p className="text-sm whitespace-pre-wrap">{entry.problemStatement || "-"}</p>
          )}
        </div>
        <div>
          <div className="text-muted-foreground mb-1 text-xs font-medium">Remark / ES Ticket</div>
          {canEdit ? (
            <EditableField value={entry.remark ?? ""} onSave={(v) => onFieldSave("remark", v)} />
          ) : (
            <p className="text-sm whitespace-pre-wrap">{entry.remark || "-"}</p>
          )}
        </div>

        <div className="border-t pt-3">
          <div className="text-muted-foreground mb-2 text-xs font-medium">交接留言</div>
          {updates.length === 0 && <p className="text-muted-foreground text-xs">尚無留言</p>}
          <ul className="space-y-2">
            {updates.map((u) => (
              <li key={u.id} className="bg-muted/50 rounded-md p-2 text-sm">
                <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs">
                  <span className="font-medium text-foreground">{u.personName ?? "未知"}</span>
                  {u.shift && <Badge variant="outline">{SHIFT_LABELS[u.shift]}</Badge>}
                  <span>{new Date(u.createdAt).toLocaleString()}</span>
                </div>
                <p className="whitespace-pre-wrap">{u.note}</p>
              </li>
            ))}
          </ul>

          {canEdit && (
            <div className="mt-3 space-y-2">
              <Textarea
                placeholder={`新增交接留言(${SHIFT_LABELS[currentShift]})...`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={noteSaving}
                className="min-h-[60px] text-sm"
              />
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={handleAddNote} disabled={noteSaving || !note.trim()}>
                  <Send className="h-3.5 w-3.5" />
                  送出
                </Button>
                {noteError && <span className="text-destructive text-xs">{noteError}</span>}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
