"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase";
import { fetchMachineGroups } from "@/lib/bom";
import {
  addGroup,
  deleteGroup,
  ensureMachineInGroup,
  fetchGroupMachineNames,
  fetchGroupMembers,
  fetchGroups,
  removeGroupMember,
  removeMachineFromGroup,
  renameGroupMember,
  upsertGroupMember,
  type Group,
  type GroupMember,
} from "@/lib/groups";
import { useTranslate } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EditableField } from "@/components/editable-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const zh: Record<string, string> = {
  "Admin Password": "管理員密碼",
  "Incorrect password": "密碼錯誤",
  Confirm: "確認",
  "Back to Home": "回首頁",
  "Edit Groups": "編輯群組",
  "Grouped by employee ID — after logging in, you only see machines owned by your own group. Machine ownership is mainly generated automatically at download time; the machine list here is just for manual fixes.":
    "依工號分組,登入後只看得到自己群組擁有的機台。機台歸屬主要由下載當下自動產生,這裡的機台列表只用來手動修正。",
  "New group name": "新增群組名稱",
  "Add Group": "新增",
  "Loading…": "載入中…",
  "No groups yet — add one to get started.": "尚無群組,請先新增。",
  "Delete Group": "刪除群組",
  "Members (Employee ID)": "成員(工號)",
  "Employee ID": "工號",
  "Name (optional)": "姓名(選填)",
  "Add Member": "新增",
  "No members yet": "尚無成員",
  "Remove Member": "移除成員",
  Machines: "機台",
  "Select a machine to add to this group": "選擇機台加入這個群組",
  "Add Machine": "新增",
  "No machines yet — add one above, or members can add them automatically via SAP download.":
    "尚無機台,可由上方新增,或由成員透過 SAP 下載自動加入。",
  "Remove Machine": "移除機台",
  'Delete group "{name}"? This will also remove all its members and machine ownership records — this cannot be undone.':
    "刪除群組「{name}」？這會同時移除該群組的所有成員與機台歸屬紀錄,無法復原。",
};

// Internal-tool-grade gate, not real security — matches the rest of
// lambom's no-auth convention (see project memory
// project_lambom_machine_groups). Anyone reading the client bundle can see
// this string; it's only meant to keep casual clicks off the gear icon.
// Deliberately not persisted anywhere (no localStorage/sessionStorage) -
// unlocked is plain component state, so leaving this page and coming back
// always re-prompts, no matter how it was left.
const ADMIN_PASSWORD = "admin";

function AdminPasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const t = useTranslate(zh);

  function submit() {
    if (password === ADMIN_PASSWORD) {
      onUnlock();
    } else {
      setError(true);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-xs">
        <CardContent className="grid gap-3 pt-6">
          <Label>{t("Admin Password")}</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{t("Incorrect password")}</p>}
          <Button onClick={submit} disabled={!password}>
            {t("Confirm")}
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">{t("Back to Home")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function GroupsPage() {
  const [unlocked, setUnlocked] = useState(false);
  const t = useTranslate(zh);

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const [members, setMembers] = useState<GroupMember[]>([]);
  const [machineNames, setMachineNames] = useState<string[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [newEmployeeId, setNewEmployeeId] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [addMachineValue, setAddMachineValue] = useState("");

  const [allMachineNames, setAllMachineNames] = useState<string[]>([]);

  useEffect(() => {
    if (!unlocked) return;
    fetchMachineGroups(getSupabase())
      .then(({ machineGroups }) => setAllMachineNames(machineGroups.map((g) => g.machine)))
      .catch(() => {
        // Best-effort — only feeds the "add machine" dropdown, doesn't
        // block the rest of the page if it fails.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  async function loadGroups() {
    setLoading(true);
    setError(null);
    try {
      setGroups(await fetchGroups(getSupabase()));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (unlocked) loadGroups();
  }, [unlocked]);

  async function loadDetail(groupId: number) {
    setDetailLoading(true);
    try {
      const [m, n] = await Promise.all([
        fetchGroupMembers(getSupabase(), groupId),
        fetchGroupMachineNames(getSupabase(), groupId),
      ]);
      setMembers(m);
      setMachineNames(n);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailLoading(false);
    }
  }

  function toggleExpanded(group: Group) {
    if (expanded === group.id) {
      setExpanded(null);
      return;
    }
    setExpanded(group.id);
    setNewEmployeeId("");
    setNewDisplayName("");
    setAddMachineValue("");
    loadDetail(group.id);
  }

  async function handleAddGroup() {
    const trimmed = newGroupName.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await addGroup(getSupabase(), trimmed);
      setNewGroupName("");
      await loadGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteGroup(group: Group) {
    if (
      !window.confirm(
        t(
          'Delete group "{name}"? This will also remove all its members and machine ownership records — this cannot be undone.'
        ).replace("{name}", group.name)
      )
    ) {
      return;
    }
    setError(null);
    try {
      await deleteGroup(getSupabase(), group.id);
      if (expanded === group.id) setExpanded(null);
      await loadGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAddMember(groupId: number) {
    const trimmed = newEmployeeId.trim();
    if (!trimmed) return;
    setError(null);
    try {
      await upsertGroupMember(getSupabase(), trimmed, groupId, newDisplayName.trim() || undefined);
      setNewEmployeeId("");
      setNewDisplayName("");
      await loadDetail(groupId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRemoveMember(groupId: number, employeeId: string) {
    setError(null);
    try {
      await removeGroupMember(getSupabase(), employeeId);
      await loadDetail(groupId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRenameMemberId(groupId: number, oldEmployeeId: string, newEmployeeId: string) {
    await renameGroupMember(getSupabase(), oldEmployeeId, newEmployeeId);
    await loadDetail(groupId);
  }

  async function handleUpdateDisplayName(groupId: number, employeeId: string, displayName: string) {
    await upsertGroupMember(getSupabase(), employeeId, groupId, displayName);
    await loadDetail(groupId);
  }

  async function handleAddMachine(groupId: number) {
    if (!addMachineValue) return;
    setError(null);
    try {
      await ensureMachineInGroup(getSupabase(), groupId, addMachineValue);
      setAddMachineValue("");
      await loadDetail(groupId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRemoveMachine(groupId: number, machineName: string) {
    setError(null);
    try {
      await removeMachineFromGroup(getSupabase(), groupId, machineName);
      await loadDetail(groupId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!unlocked) {
    return <AdminPasswordGate onUnlock={() => setUnlocked(true)} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-8 md:px-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("Edit Groups")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                "Grouped by employee ID — after logging in, you only see machines owned by your own group. Machine ownership is mainly generated automatically at download time; the machine list here is just for manual fixes."
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Button variant="outline" asChild>
              <Link href="/">{t("Back to Home")}</Link>
            </Button>
          </div>
        </div>

        <div className="mb-4 flex gap-2">
          <Input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder={t("New group name")}
            onKeyDown={(e) => e.key === "Enter" && handleAddGroup()}
          />
          <Button onClick={handleAddGroup} disabled={saving || !newGroupName.trim()}>
            {t("Add Group")}
          </Button>
        </div>

        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

        {loading ? (
          <p className="text-sm text-muted-foreground">{t("Loading…")}</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("No groups yet — add one to get started.")}</p>
        ) : (
          <div className="grid gap-3">
            {groups.map((group) => {
              const isExpanded = expanded === group.id;
              return (
                <Card key={group.id}>
                  <CardContent className="flex items-center gap-2 p-0">
                    <button
                      type="button"
                      className="flex flex-1 items-center gap-2 p-4 text-left hover:bg-accent"
                      onClick={() => toggleExpanded(group)}
                    >
                      <ChevronDown
                        className={cn("h-4 w-4 shrink-0 transition-transform", isExpanded && "rotate-180")}
                      />
                      <span className="flex-1 text-sm font-medium">{group.name}</span>
                    </button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("Delete Group")}
                      className="mr-4"
                      onClick={() => handleDeleteGroup(group)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </CardContent>
                  <CardContent className="p-0">
                    {isExpanded && (
                      <div className="border-t p-4">
                        {detailLoading ? (
                          <p className="text-sm text-muted-foreground">{t("Loading…")}</p>
                        ) : (
                          <>
                            <Label className="mb-1.5 block">{t("Members (Employee ID)")}</Label>
                            <div className="mb-2 flex gap-2">
                              <Input
                                value={newEmployeeId}
                                onChange={(e) => setNewEmployeeId(e.target.value)}
                                placeholder={t("Employee ID")}
                                className="w-28"
                              />
                              <Input
                                value={newDisplayName}
                                onChange={(e) => setNewDisplayName(e.target.value)}
                                placeholder={t("Name (optional)")}
                                onKeyDown={(e) => e.key === "Enter" && handleAddMember(group.id)}
                              />
                              <Button size="sm" onClick={() => handleAddMember(group.id)} disabled={!newEmployeeId.trim()}>
                                {t("Add Member")}
                              </Button>
                            </div>
                            <div className="mb-4 grid gap-1.5">
                              {members.length === 0 ? (
                                <p className="text-sm text-muted-foreground">{t("No members yet")}</p>
                              ) : (
                                members.map((m) => (
                                  <div key={m.employeeId} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                                    <div className="w-28 shrink-0">
                                      <EditableField
                                        value={m.employeeId}
                                        onSave={(newId) => handleRenameMemberId(group.id, m.employeeId, newId)}
                                      />
                                    </div>
                                    <div className="flex-1">
                                      <EditableField
                                        value={m.displayName ?? ""}
                                        onSave={(newName) => handleUpdateDisplayName(group.id, m.employeeId, newName)}
                                      />
                                    </div>
                                    <Button
                                      size="icon-sm"
                                      variant="ghost"
                                      aria-label={t("Remove Member")}
                                      onClick={() => handleRemoveMember(group.id, m.employeeId)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                    </Button>
                                  </div>
                                ))
                              )}
                            </div>

                            <Label className="mb-1.5 block">{t("Machines")}</Label>
                            <div className="mb-2 flex gap-2">
                              <Select value={addMachineValue} onValueChange={setAddMachineValue}>
                                <SelectTrigger className="flex-1">
                                  <SelectValue placeholder={t("Select a machine to add to this group")} />
                                </SelectTrigger>
                                <SelectContent>
                                  {allMachineNames
                                    .filter((name) => !machineNames.includes(name))
                                    .map((name) => (
                                      <SelectItem key={name} value={name}>
                                        {name}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                              <Button size="sm" onClick={() => handleAddMachine(group.id)} disabled={!addMachineValue}>
                                {t("Add Machine")}
                              </Button>
                            </div>
                            <div className="grid gap-1">
                              {machineNames.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  {t("No machines yet — add one above, or members can add them automatically via SAP download.")}
                                </p>
                              ) : (
                                machineNames.map((name) => (
                                  <div key={name} className="flex items-center justify-between rounded-md border px-2 py-1.5">
                                    <span className="text-sm">{name}</span>
                                    <Button
                                      size="icon-sm"
                                      variant="ghost"
                                      aria-label={t("Remove Machine")}
                                      onClick={() => handleRemoveMachine(group.id, name)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                    </Button>
                                  </div>
                                ))
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
