"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { addPerson, setPersonActive, type PassdownPerson } from "@/lib/passdown";
import { useTranslate } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LanguageSwitcher } from "@/components/language-switcher";

const zh: Record<string, string> = {
  "Passdown People List": "Passdown 人員名單",
  "Manage the names available on the passdown board. Deactivated people won't appear in the picker, but history is preserved.":
    "管理可在交接看板選擇的名字。停用的人不會出現在選單,但歷史紀錄仍會保留。",
  "Back to Board": "回看板",
  "Add person name": "新增人員姓名",
  Add: "新增",
  "Loading...": "載入中...",
  "No people yet — add one first.": "尚無人員,請先新增。",
  Deactivate: "停用",
  Activate: "啟用",
};

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
  const t = useTranslate(zh);

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
            <h1 className="text-2xl font-semibold tracking-tight">{t("Passdown People List")}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t(
                "Manage the names available on the passdown board. Deactivated people won't appear in the picker, but history is preserved."
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Button variant="outline" asChild>
              <Link href="/passdown">{t("Back to Board")}</Link>
            </Button>
          </div>
        </div>

        <div className="mb-4 flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("Add person name")}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <Button onClick={handleAdd} disabled={saving || !newName.trim()}>
            {t("Add")}
          </Button>
        </div>

        {error && <p className="text-destructive mb-3 text-sm">{error}</p>}

        <Card>
          <CardContent className="divide-y pt-6">
            {loading ? (
              <p className="text-muted-foreground text-sm">{t("Loading...")}</p>
            ) : people.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("No people yet — add one first.")}</p>
            ) : (
              people.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2">
                  <span className={p.active ? "" : "text-muted-foreground line-through"}>{p.name}</span>
                  <Button variant="outline" size="sm" onClick={() => handleToggleActive(p)}>
                    {p.active ? t("Deactivate") : t("Activate")}
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
