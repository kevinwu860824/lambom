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
        setInitError(`Failed to load: ${error.message}`);
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
      setInitError(`Failed to load: ${err instanceof Error ? err.message : String(err)}`);
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
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-white">Data Editor</h1>
          <p className="mt-1 text-sm text-white/70">
            The left side shows the current content of the &quot;Data&quot; table;
            enter new content on the right and click Replace.
          </p>
        </div>

        {initError && (
          <Card className="mb-6 border-destructive/50">
            <CardContent className="text-destructive text-sm">{initError}</CardContent>
          </Card>
        )}

        {saveError && (
          <Card className="mb-6 border-destructive/50">
            <CardContent className="text-destructive text-sm">Replace failed: {saveError}</CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Current Content</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={initLoading ? "Loading…" : currentContent}
                readOnly
                disabled
                className="h-[420px] resize-none font-mono text-sm"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>New Content</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
                placeholder="Enter the replacement text…"
                disabled={initLoading}
                className="h-[420px] resize-none font-mono text-sm"
              />
              <div className="mt-3 flex items-center gap-3">
                <Button onClick={handleReplace} disabled={initLoading || saving}>
                  {saving ? "Replacing…" : "Replace"}
                </Button>
                {saveSuccess && (
                  <span className="text-sm text-emerald-600">Updated</span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
