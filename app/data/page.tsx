"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export default function DataPage() {
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
        setInitError(`載入失敗:${error.message}`);
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
      setInitError(`載入失敗:${err instanceof Error ? err.message : String(err)}`);
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
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">資料編輯</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            左邊顯示 Supabase「Data」表目前的內容,右邊輸入新內容並按下取代。
          </p>
        </div>

        {initError && (
          <Card className="mb-6 border-destructive/50">
            <CardContent className="text-destructive text-sm">{initError}</CardContent>
          </Card>
        )}

        {saveError && (
          <Card className="mb-6 border-destructive/50">
            <CardContent className="text-destructive text-sm">取代失敗:{saveError}</CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>目前內容</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={initLoading ? "載入中…" : currentContent}
                readOnly
                disabled
                className="h-[420px] resize-none font-mono text-sm"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>新內容</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
                placeholder="輸入要取代的文字…"
                disabled={initLoading}
                className="h-[420px] resize-none font-mono text-sm"
              />
              <div className="mt-3 flex items-center gap-3">
                <Button onClick={handleReplace} disabled={initLoading || saving}>
                  {saving ? "取代中…" : "取代"}
                </Button>
                {saveSuccess && (
                  <span className="text-sm text-emerald-600">已更新</span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
