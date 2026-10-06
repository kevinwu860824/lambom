"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx-js-style";
import { ArrowLeft, Plus, Trash2, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase";
import {
  addModel,
  deleteModel,
  fetchMachineModelLinks,
  fetchModels,
  setMachineModelLink,
  setModelBomData,
  type InventoryModel,
  type MachineModelLink,
} from "@/lib/inventory";
import { useEmployeeGroup } from "@/lib/groups";
import { useTranslate } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RequireGroupPrompt } from "@/components/require-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LanguageSwitcher } from "@/components/language-switcher";

const zh: Record<string, string> = {
  "Machine Settings": "機台設定",
  "Manage machine models, BOM data, and which model each machine uses.":
    "管理機型、BOM 資料,以及每台機台對應哪個機型。",
  "Back to Inventory": "回庫存管理",
  "Machine Models": "機型",
  "New model name…": "新機型名稱…",
  Add: "新增",
  "BOM Parts": "BOM 零件",
  "Import from Excel": "匯入 Excel",
  "Looks for an \"Object description\" / 品名 column (part name) and an optional \"Component\" / 規格 column (spec), same as the original tool.":
    "會尋找「Object description」/ 品名 欄位(零件名稱)跟選填的「Component」/ 規格 欄位,跟原工具解析邏輯一致。",
  "Could not find an \"Object description\" / 品名 column in this file.": "在這個檔案裡找不到「Object description」/ 品名 欄位。",
  "Imported {n} BOM parts.": "已匯入 {n} 個 BOM 零件。",
  "Select a model to manage its BOM.": "選一個機型來管理它的 BOM。",
  "No models yet.": "尚無機型。",
  "Delete this model? Machines linked to it will lose that link too.":
    "刪除這個機型?連結到它的機台也會一併解除連結。",
  "Machines in Your Group": "你的群組機台",
  "Pick which model each machine uses, so Report a Part can show its BOM list.":
    "設定每台機台對應哪個機型,回報零件時就能帶出該機型的 BOM 清單。",
  "No model": "無機型",
  "No machines in your group yet.": "你的群組目前沒有機台。",
};

export default function InventoryMachinesPage() {
  const t = useTranslate(zh);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  const { employeeId, allowedMachines, notFound, loading: groupLoading } = useEmployeeGroup();

  const [models, setModels] = useState<InventoryModel[]>([]);
  const [links, setLinks] = useState<MachineModelLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newModelName, setNewModelName] = useState("");
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabase();
      const [mo, l] = await Promise.all([fetchModels(supabase), fetchMachineModelLinks(supabase)]);
      setModels(mo);
      setLinks(l);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!employeeId) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  async function handleAddModel() {
    const name = newModelName.trim();
    if (!name) return;
    try {
      await addModel(getSupabase(), name);
      setNewModelName("");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteModel(id: number) {
    if (!window.confirm(t("Delete this model? Machines linked to it will lose that link too."))) return;
    try {
      await deleteModel(getSupabase(), id);
      if (selectedModelId === id) setSelectedModelId(null);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleBomFile(e: React.ChangeEvent<HTMLInputElement>, modelId: number) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    file.arrayBuffer().then(async (buffer) => {
      setImportMessage(null);
      setError(null);
      try {
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });

        let headerIdx = -1;
        let nameColIdx = -1;
        let specColIdx = -1;
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const nameIdx = row.findIndex((cell) => /Object description|品名|品\s?名|零件/i.test(String(cell)));
          if (nameIdx !== -1) {
            headerIdx = i;
            nameColIdx = nameIdx;
            specColIdx = row.findIndex(
              (cell, idx) => idx !== nameColIdx && /Component|規格|型號|Spec|Item Number/i.test(String(cell))
            );
            break;
          }
        }
        if (headerIdx === -1) throw new Error(t('Could not find an "Object description" / 品名 column in this file.'));

        const bom = rows
          .slice(headerIdx + 1)
          .map((row) => {
            const name = (row[nameColIdx] ?? "").toString().trim();
            if (!name) return null;
            const spec = specColIdx !== -1 ? (row[specColIdx] ?? "").toString().trim() : "";
            return spec ? `${name} (${spec})` : name;
          })
          .filter((v): v is string => v !== null);

        await setModelBomData(getSupabase(), modelId, bom);
        setImportMessage(t("Imported {n} BOM parts.").replace("{n}", String(bom.length)));
        await loadAll();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  async function handleLinkChange(machineName: string, modelIdValue: string) {
    try {
      await setMachineModelLink(getSupabase(), machineName, modelIdValue ? Number(modelIdValue) : null);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (groupLoading) return null;
  if (!employeeId || notFound) {
    return (
      <div className="bg-background min-h-screen">
        <RequireGroupPrompt notFound={notFound} employeeId={employeeId} />
      </div>
    );
  }

  const selectedModel = models.find((m) => m.id === selectedModelId) ?? null;
  const machineNames = Array.from(allowedMachines ?? []).sort();
  const linkByMachine = new Map(links.map((l) => [l.machineName, l.modelId]));

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("Machine Settings")}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("Manage machine models, BOM data, and which model each machine uses.")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Button variant="outline" size="icon" asChild aria-label={t("Back to Inventory")}>
              <Link href="/inventory">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        {error && <p className="text-destructive mb-4 text-sm">{error}</p>}

        {!loading && (
          <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("Machine Models")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-3 flex gap-2">
                  <Input
                    placeholder={t("New model name…")}
                    value={newModelName}
                    onChange={(e) => setNewModelName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddModel();
                    }}
                  />
                  <Button variant="outline" size="icon" onClick={handleAddModel} aria-label={t("Add")}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {models.length === 0 ? (
                  <p className="text-muted-foreground text-sm italic">{t("No models yet.")}</p>
                ) : (
                  <div className="grid gap-1">
                    {models.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setSelectedModelId(m.id)}
                        className={`hover:bg-accent flex items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm ${
                          selectedModelId === m.id ? "bg-accent font-medium" : ""
                        }`}
                      >
                        <span className="truncate">{m.name}</span>
                        <Trash2
                          className="text-muted-foreground hover:text-destructive h-3.5 w-3.5 shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteModel(m.id);
                          }}
                        />
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                {!selectedModel ? (
                  <p className="text-muted-foreground py-10 text-center text-sm">
                    {t("Select a model to manage its BOM.")}
                  </p>
                ) : (
                  <div className="grid gap-6">
                    <div>
                      <h2 className="mb-2 text-lg font-semibold">{selectedModel.name}</h2>
                      <Badge variant="outline">
                        {t("BOM Parts")} {selectedModel.bomData.length}
                      </Badge>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-sm font-medium">{t("BOM Parts")}</label>
                      <div className="relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center">
                        <input
                          type="file"
                          accept=".xlsx,.xls"
                          className="absolute inset-0 cursor-pointer opacity-0"
                          onChange={(e) => handleBomFile(e, selectedModel.id)}
                        />
                        <Upload className="text-muted-foreground h-6 w-6" />
                        <p className="text-sm font-medium">{t("Import from Excel")}</p>
                        <p className="text-muted-foreground text-xs">
                          {t(
                            'Looks for an "Object description" / 品名 column (part name) and an optional "Component" / 規格 column (spec), same as the original tool.'
                          )}
                        </p>
                      </div>
                      {importMessage && <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">{importMessage}</p>}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">{t("Machines in Your Group")}</CardTitle>
            <p className="text-muted-foreground text-sm">
              {t("Pick which model each machine uses, so Report a Part can show its BOM list.")}
            </p>
          </CardHeader>
          <CardContent>
            {machineNames.length === 0 ? (
              <p className="text-muted-foreground text-sm italic">{t("No machines in your group yet.")}</p>
            ) : (
              <div className="grid gap-2">
                {machineNames.map((name) => (
                  <div key={name} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <p className="font-medium">{name}</p>
                    <Select
                      value={linkByMachine.get(name) ? String(linkByMachine.get(name)) : ""}
                      onValueChange={(v) => handleLinkChange(name, v)}
                    >
                      <SelectTrigger className="w-56">
                        <SelectValue placeholder={t("No model")} />
                      </SelectTrigger>
                      <SelectContent>
                        {models.map((m) => (
                          <SelectItem key={m.id} value={String(m.id)}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
