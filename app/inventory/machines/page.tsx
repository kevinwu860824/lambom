"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx-js-style";
import { ArrowLeft, Plus, Trash2, Upload, X as XIcon } from "lucide-react";
import { createClient } from "@/lib/supabase";
import {
  addMachine,
  addModel,
  addPredefinedCodes,
  deleteMachine,
  deleteModel,
  deletePredefinedCode,
  fetchMachines,
  fetchModels,
  fetchPredefinedCodes,
  setModelBomData,
  updateMachine,
  type InventoryMachine,
  type InventoryModel,
  type PredefinedCode,
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
  "Manage machine models, BOM data, serial numbers, and the machine list.":
    "管理機型、BOM 資料、序號,以及機台清單。",
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
  "Reserved Serial Numbers": "預定義機台序號",
  "Add serial numbers — comma or newline separated…": "輸入序號(可用逗號或換行分隔多個)…",
  "Select a model to manage its BOM/serial numbers.": "選一個機型來管理它的 BOM / 序號。",
  "No models yet.": "尚無機型。",
  "Delete this model? Its BOM and reserved serial numbers will be deleted too.":
    "刪除這個機型?它的 BOM 資料跟預定義序號也會一起刪除。",
  Machines: "機台",
  "Add Machine": "新增機台",
  "No model": "無機型",
  Code: "編號",
  Name: "名稱",
  Model: "機型",
  Save: "儲存",
  Cancel: "取消",
  Edit: "編輯",
  "Delete this machine? Its report history will be deleted too.": "刪除這台機台?它的報修紀錄也會一起刪除。",
  "No machines yet.": "尚無機台。",
};

export default function InventoryMachinesPage() {
  const t = useTranslate(zh);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  const { employeeId, notFound, loading: groupLoading } = useEmployeeGroup();

  const [models, setModels] = useState<InventoryModel[]>([]);
  const [codes, setCodes] = useState<PredefinedCode[]>([]);
  const [machines, setMachines] = useState<InventoryMachine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newModelName, setNewModelName] = useState("");
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [newCodeInput, setNewCodeInput] = useState("");
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const [showAddMachine, setShowAddMachine] = useState(false);
  const [newMachine, setNewMachine] = useState({ code: "", name: "", modelId: "" });
  const [editingMachineId, setEditingMachineId] = useState<number | null>(null);
  const [editMachine, setEditMachine] = useState({ code: "", name: "", modelId: "" });

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabase();
      const [mo, c, m] = await Promise.all([
        fetchModels(supabase),
        fetchPredefinedCodes(supabase),
        fetchMachines(supabase),
      ]);
      setModels(mo);
      setCodes(c);
      setMachines(m);
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
    if (!window.confirm(t("Delete this model? Its BOM and reserved serial numbers will be deleted too."))) return;
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

  async function handleAddCodes() {
    if (!selectedModelId || !newCodeInput.trim()) return;
    const codeList = newCodeInput
      .split(/[,，\n]/)
      .map((c) => c.trim())
      .filter(Boolean);
    try {
      await addPredefinedCodes(getSupabase(), selectedModelId, codeList);
      setNewCodeInput("");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteCode(id: number) {
    try {
      await deletePredefinedCode(getSupabase(), id);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAddMachine(e: React.FormEvent) {
    e.preventDefault();
    try {
      await addMachine(getSupabase(), {
        code: newMachine.code.trim(),
        name: newMachine.name.trim(),
        modelId: newMachine.modelId ? Number(newMachine.modelId) : null,
      });
      setShowAddMachine(false);
      setNewMachine({ code: "", name: "", modelId: "" });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSaveMachineEdit(id: number) {
    try {
      await updateMachine(getSupabase(), id, {
        code: editMachine.code.trim(),
        name: editMachine.name.trim(),
        modelId: editMachine.modelId ? Number(editMachine.modelId) : null,
      });
      setEditingMachineId(null);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteMachine(id: number) {
    if (!window.confirm(t("Delete this machine? Its report history will be deleted too."))) return;
    try {
      await deleteMachine(getSupabase(), id);
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
  const codesForSelectedModel = codes.filter((c) => c.modelId === selectedModelId);

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("Machine Settings")}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("Manage machine models, BOM data, serial numbers, and the machine list.")}
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
                    {t("Select a model to manage its BOM/serial numbers.")}
                  </p>
                ) : (
                  <div className="grid gap-6">
                    <div>
                      <h2 className="mb-2 text-lg font-semibold">{selectedModel.name}</h2>
                      <div className="flex gap-2">
                        <Badge variant="outline">
                          {t("BOM Parts")} {selectedModel.bomData.length}
                        </Badge>
                        <Badge variant="outline">
                          {t("Reserved Serial Numbers")} {codesForSelectedModel.length}
                        </Badge>
                      </div>
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

                    <div>
                      <label className="mb-1.5 block text-sm font-medium">{t("Reserved Serial Numbers")}</label>
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {codesForSelectedModel.map((c) => (
                          <span
                            key={c.id}
                            className="bg-muted inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                          >
                            {c.code}
                            <button type="button" onClick={() => handleDeleteCode(c.id)} aria-label="Delete code">
                              <XIcon className="text-muted-foreground hover:text-destructive h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Input
                          placeholder={t("Add serial numbers — comma or newline separated…")}
                          value={newCodeInput}
                          onChange={(e) => setNewCodeInput(e.target.value)}
                        />
                        <Button variant="outline" onClick={handleAddCodes}>
                          {t("Add")}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <Card className="mt-6">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t("Machines")}</CardTitle>
            <Button size="sm" onClick={() => setShowAddMachine((v) => !v)}>
              <Plus className="h-4 w-4" /> {t("Add Machine")}
            </Button>
          </CardHeader>
          <CardContent>
            {showAddMachine && (
              <form onSubmit={handleAddMachine} className="mb-4 grid gap-3 rounded-lg border p-4 md:grid-cols-4">
                <Input
                  required
                  placeholder={t("Code")}
                  value={newMachine.code}
                  onChange={(e) => setNewMachine({ ...newMachine, code: e.target.value })}
                />
                <Input
                  required
                  placeholder={t("Name")}
                  value={newMachine.name}
                  onChange={(e) => setNewMachine({ ...newMachine, name: e.target.value })}
                />
                <Select
                  value={newMachine.modelId}
                  onValueChange={(v) => setNewMachine({ ...newMachine, modelId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("Model")} />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="submit">{t("Save")}</Button>
              </form>
            )}

            {machines.length === 0 ? (
              <p className="text-muted-foreground text-sm italic">{t("No machines yet.")}</p>
            ) : (
              <div className="grid gap-2">
                {machines.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    {editingMachineId === m.id ? (
                      <div className="grid flex-1 gap-2 md:grid-cols-4">
                        <Input
                          value={editMachine.code}
                          onChange={(e) => setEditMachine({ ...editMachine, code: e.target.value })}
                        />
                        <Input
                          value={editMachine.name}
                          onChange={(e) => setEditMachine({ ...editMachine, name: e.target.value })}
                        />
                        <Select
                          value={editMachine.modelId}
                          onValueChange={(v) => setEditMachine({ ...editMachine, modelId: v })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t("Model")} />
                          </SelectTrigger>
                          <SelectContent>
                            {models.map((mo) => (
                              <SelectItem key={mo.id} value={String(mo.id)}>
                                {mo.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => handleSaveMachineEdit(m.id)}>
                            {t("Save")}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditingMachineId(null)}>
                            {t("Cancel")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div>
                          <p className="font-medium">
                            {m.code} <span className="text-muted-foreground">— {m.name}</span>
                          </p>
                          <p className="text-muted-foreground text-xs">{m.modelName ?? t("No model")}</p>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingMachineId(m.id);
                              setEditMachine({
                                code: m.code,
                                name: m.name,
                                modelId: m.modelId ? String(m.modelId) : "",
                              });
                            }}
                          >
                            {t("Edit")}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleDeleteMachine(m.id)}>
                            <Trash2 className="text-destructive h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </>
                    )}
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
