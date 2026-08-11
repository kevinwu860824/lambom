"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase";
import {
  addGroup,
  deleteGroup,
  fetchGroupMachineNames,
  fetchGroupMembers,
  fetchGroups,
  removeGroupMember,
  removeMachineFromGroup,
  upsertGroupMember,
  type Group,
  type GroupMember,
} from "@/lib/groups";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Internal-tool-grade gate, not real security — matches the rest of
// lambom's no-auth convention (see project memory
// project_lambom_machine_groups). Anyone reading the client bundle can see
// this string; it's only meant to keep casual clicks off the gear icon.
const ADMIN_PASSWORD = "admin";
const UNLOCK_STORAGE_KEY = "lambom_groups_admin_unlocked";

function AdminPasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);

  function submit() {
    if (password === ADMIN_PASSWORD) {
      sessionStorage.setItem(UNLOCK_STORAGE_KEY, "1");
      onUnlock();
    } else {
      setError(true);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-xs">
        <CardContent className="grid gap-3 pt-6">
          <Label>管理員密碼</Label>
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
          {error && <p className="text-sm text-destructive">密碼錯誤</p>}
          <Button onClick={submit} disabled={!password}>
            確認
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">回首頁</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function GroupsPage() {
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(UNLOCK_STORAGE_KEY) === "1") setUnlocked(true);
  }, []);

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
    if (!window.confirm(`刪除群組「${group.name}」？這會同時移除該群組的所有成員與機台歸屬紀錄,無法復原。`)) {
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
            <h1 className="text-2xl font-semibold tracking-tight">編輯群組</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              依工號分組,登入後只看得到自己群組擁有的機台。機台歸屬主要由下載當下自動產生,這裡的機台列表只用來手動修正。
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/">回首頁</Link>
          </Button>
        </div>

        <div className="mb-4 flex gap-2">
          <Input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="新增群組名稱"
            onKeyDown={(e) => e.key === "Enter" && handleAddGroup()}
          />
          <Button onClick={handleAddGroup} disabled={saving || !newGroupName.trim()}>
            新增
          </Button>
        </div>

        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

        {loading ? (
          <p className="text-sm text-muted-foreground">載入中...</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">尚無群組,請先新增。</p>
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
                      aria-label="刪除群組"
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
                          <p className="text-sm text-muted-foreground">載入中...</p>
                        ) : (
                          <>
                            <Label className="mb-1.5 block">成員(工號)</Label>
                            <div className="mb-2 flex gap-2">
                              <Input
                                value={newEmployeeId}
                                onChange={(e) => setNewEmployeeId(e.target.value)}
                                placeholder="工號"
                                className="w-28"
                              />
                              <Input
                                value={newDisplayName}
                                onChange={(e) => setNewDisplayName(e.target.value)}
                                placeholder="姓名(選填)"
                                onKeyDown={(e) => e.key === "Enter" && handleAddMember(group.id)}
                              />
                              <Button size="sm" onClick={() => handleAddMember(group.id)} disabled={!newEmployeeId.trim()}>
                                新增
                              </Button>
                            </div>
                            <div className="mb-4 grid gap-1">
                              {members.length === 0 ? (
                                <p className="text-sm text-muted-foreground">尚無成員</p>
                              ) : (
                                members.map((m) => (
                                  <div key={m.employeeId} className="flex items-center justify-between rounded-md border px-2 py-1.5">
                                    <span className="text-sm">
                                      {m.employeeId}
                                      {m.displayName && <span className="text-muted-foreground"> · {m.displayName}</span>}
                                    </span>
                                    <Button
                                      size="icon-sm"
                                      variant="ghost"
                                      aria-label="移除成員"
                                      onClick={() => handleRemoveMember(group.id, m.employeeId)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                    </Button>
                                  </div>
                                ))
                              )}
                            </div>

                            <Label className="mb-1.5 block">機台</Label>
                            <div className="grid gap-1">
                              {machineNames.length === 0 ? (
                                <p className="text-sm text-muted-foreground">尚無機台,請成員自行透過 SAP 下載自動加入。</p>
                              ) : (
                                machineNames.map((name) => (
                                  <div key={name} className="flex items-center justify-between rounded-md border px-2 py-1.5">
                                    <span className="text-sm">{name}</span>
                                    <Button
                                      size="icon-sm"
                                      variant="ghost"
                                      aria-label="移除機台"
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
