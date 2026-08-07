"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { addPerson, setPersonActive, type PassdownPerson } from "@/lib/passdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// Deliberately just a name list, no login/password — matches the rest of
// lambom's no-auth pattern. This is the placeholder for a future proper
// user-management feature; for now, adding someone here is what makes them
// selectable in the /passdown "我是" picker.
export default function PassdownPeoplePage() {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  const [people, setPeople] = useState<PassdownPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await getSupabase()
        .from("passdown_people")
        .select("id,name,active")
        .order("name");
      if (fetchError) throw new Error(fetchError.message);
      setPeople((data ?? []) as PassdownPerson[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleAdd() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await addPerson(getSupabase(), trimmed);
      setNewName("");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(person: PassdownPerson) {
    setError(null);
    try {
      await setPersonActive(getSupabase(), person.id, !person.active);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-xl px-4 py-8 md:px-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Passdown 人員名單</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              管理可在交接看板選擇的名字。停用的人不會出現在選單,但歷史紀錄仍會保留。
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/passdown">回看板</Link>
          </Button>
        </div>

        <div className="mb-4 flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="新增人員姓名"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <Button onClick={handleAdd} disabled={saving || !newName.trim()}>
            新增
          </Button>
        </div>

        {error && <p className="text-destructive mb-3 text-sm">{error}</p>}

        <Card>
          <CardContent className="divide-y pt-6">
            {loading ? (
              <p className="text-muted-foreground text-sm">載入中...</p>
            ) : people.length === 0 ? (
              <p className="text-muted-foreground text-sm">尚無人員,請先新增。</p>
            ) : (
              people.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2">
                  <span className={p.active ? "" : "text-muted-foreground line-through"}>{p.name}</span>
                  <Button variant="outline" size="sm" onClick={() => handleToggleActive(p)}>
                    {p.active ? "停用" : "啟用"}
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
