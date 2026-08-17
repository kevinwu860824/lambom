"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import { useTranslate } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { LanguageSwitcher } from "@/components/language-switcher";

const zh: Record<string, string> = {
  "Data Editor": "資料編輯器",
  'The left side shows the current content of the "Data" table; enter new content on the right and click Replace.':
    '左側顯示「Data」資料表目前的內容,請在右側輸入新內容後點擊取代。',
  "Failed to load:": "載入失敗:",
  "Replace failed:": "取代失敗:",
  "Current Content": "目前內容",
  "Loading…": "載入中…",
  "New Content": "新內容",
  "Enter the replacement text…": "輸入取代文字…",
  "Replacing…": "取代中…",
  Replace: "取代",
  Updated: "已更新",
};

export default function DataPage() {
  const t = useTranslate(zh);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) {
      supabaseRef.current = createClient();
    }
    return supabaseRef.current;
  }

  const rowIdRef = useRef<number | null>(null);

  const [currentContent, setCurrentContent] = useState("");
  const [draftContent, setDraftContent] = useState("");

  const [initLoading, setInitLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      const { data, error } = await getSupabase()
        .from("Data")
        .select("id,Data")
        .order("id", { ascending: true })
        .limit(1);

      if (cancelled) return;

      if (error) {
        setInitError(`${t("Failed to load:")} ${error.message}`);
        setInitLoading(false);
        return;
      }

      const row = data?.[0] ?? null;
      rowIdRef.current = row?.id ?? null;
      setCurrentContent(row?.Data ?? "");
      setInitLoading(false);
    }

    loadData().catch((err) => {
      if (cancelled) return;
      setInitError(`${t("Failed to load:")} ${err instanceof Error ? err.message : String(err)}`);
      setInitLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleReplace() {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      if (rowIdRef.current !== null) {
        const { error } = await getSupabase()
          .from("Data")
          .update({ Data: draftContent })
          .eq("id", rowIdRef.current);

        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await getSupabase()
          .from("Data")
          .insert({ Data: draftContent })
          .select("id")
          .single();

        if (error) throw new Error(error.message);
        rowIdRef.current = data.id;
      }

      setCurrentContent(draftContent);
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("Data Editor")}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t(
                'The left side shows the current content of the "Data" table; enter new content on the right and click Replace.'
              )}
            </p>
          </div>
          <LanguageSwitcher />
        </div>

        {initError && (
          <Card className="mb-6 border-destructive/50">
            <CardContent className="text-destructive text-sm">{initError}</CardContent>
          </Card>
        )}

        {saveError && (
          <Card className="mb-6 border-destructive/50">
            <CardContent className="text-destructive text-sm">
              {t("Replace failed:")} {saveError}
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("Current Content")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={initLoading ? t("Loading…") : currentContent}
                readOnly
                disabled
                className="h-[420px] resize-none font-mono text-sm"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("New Content")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
                placeholder={t("Enter the replacement text…")}
                disabled={initLoading}
                className="h-[420px] resize-none font-mono text-sm"
              />
              <div className="mt-3 flex items-center gap-3">
                <Button onClick={handleReplace} disabled={initLoading || saving}>
                  {saving ? t("Replacing…") : t("Replace")}
                </Button>
                {saveSuccess && (
                  <span className="text-sm text-emerald-600">{t("Updated")}</span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
