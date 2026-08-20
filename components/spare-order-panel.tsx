"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send, X as XIcon } from "lucide-react";
import {
  cancelD365Order,
  confirmD365Submit,
  fillD365Form,
  isD365OrderAvailable,
  onD365OrderLog,
  type D365OrderPayload,
} from "@/lib/d365-order";
import { useTranslate } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const zh: Record<string, string> = {
  "Spare Part Order": "訂料自動化",
  "Desktop app only — open this page inside the lambom desktop app to use this tool.":
    "僅限桌面版 — 請在 lambom 桌面應用程式裡開啟此頁面才能使用。",
  "Problem Description": "問題描述",
  "Shared as the starting text for Work Order Description, Reported Problem Detail, and the Quality Escape Problem Description — edit any of those individually afterward if needed.":
    "會作為 Work Order 的 Description、Reported Problem Detail,以及 Quality Escape 的 Problem Description 的起始文字 — 之後有需要可以個別再改。",
  "Work Order": "Work Order",
  "Installation?": "Installation?",
  "Service Type": "Service Type",
  "FID (Customer Asset)": "FID(Customer Asset)",
  "e.g. 255711": "例如 255711",
  "Chamber (only needed if this FID has multiple chambers)": "Chamber(此 FID 有多個 chamber 時才需要填)",
  "e.g. PM1": "例如 PM1",
  "SEMI E10 Asset State": "SEMI E10 Asset State",
  "SEMI E10 Asset Substatus": "SEMI E10 Asset Substatus",
  "Quality Escape": "Quality Escape",
  "Customer Temperature": "Customer Temperature",
  "Are Wafers Scrapped?": "Are Wafers Scrapped?",
  "Customer Tracking Type": "Customer Tracking Type",
  "(leave blank to leave unset, matching the recorded default)": "(留空 = 不設定,跟錄製的預設一致)",
  "Safety Issue?": "Safety Issue?",
  "Instl/Upgrd Commit Date": "Instl/Upgrd Commit Date",
  "Quality Escape Item": "Quality Escape Item",
  "What (Object) is causing the problem?": "造成問題的原因是什麼?",
  "What is the deviation?": "偏差是什麼?",
  "What is it supposed to be (Specification)?": "應該要是什麼(規格)?",
  "Additional notes (optional)": "補充說明(選填)",
  "Product / Delivery": "料號 / 交期",
  "Part No.": "料號",
  "Priority Code": "優先碼",
  "Delivery Date": "交期日期",
  "Delivery Time": "交期時間",
  "Location / Dock": "地點 / 卸貨口",
  "Contact Name": "聯絡人",
  "Contact Phone": "聯絡電話",
  "Fill D365 Form": "自動填寫 D365 表單",
  "Filling…": "填寫中…",
  "Work Order created: {id}": "已建立 Work Order:{id}",
  "Everything is filled in — review the Edge window, then either confirm or discard.":
    "已經全部填完 — 請檢查 Edge 視窗內容,再決定確認或放棄。",
  "Automated submission isn't implemented yet — after confirming, please click \"Upload to SAP\" yourself in the still-open Edge window.":
    "自動送出功能還沒實作 — 按下確認後,請自行在還開著的 Edge 視窗裡按下「Upload to SAP」。",
  Confirm: "確認",
  Discard: "放棄",
  "Start a new order": "開始新的一筆訂料",
};

const DEFAULT_PAYLOAD: D365OrderPayload = {
  workOrder: {
    installation: "Non Installation",
    description: "",
    reportedProblemDetail: "",
    serviceType: "Warranty Service (ZSM3)",
    fid: "",
    chamber: "",
    e10AssetState: "Unscheduled Down Time",
    e10AssetSubstatus: "Repair",
  },
  qualityEscape: {
    customerTemperature: "Unknown",
    wafersScrapped: "No",
    customerTrackingType: "",
    safetyIssue: "No",
    commitDate: "Minor Commit Date Missed",
    problemDescription: "",
  },
  qualityEscapeItem: {
    causingProblem: "",
    deviation: "",
    specification: "",
    additionalNotes: "",
  },
  product: {
    partNo: "",
    priorityCode: "P0",
    // Deliberately blank — never pre-fill a hardcoded date from the
    // recording, the user always types a real one.
    deliveryDate: "",
    deliveryTime: "",
    location: "",
    contactName: "",
    contactPhone: "",
  },
};

type Stage = "form" | "filling" | "review";

/**
 * Only does anything inside the lambom desktop (Electron) shell — same
 * "renders nothing in a regular browser tab" pattern as FidDownloaderPanel.
 *
 * v1 stops at the review checkpoint: "Fill D365 Form" drives Edge through
 * Work Order / Bookable Resource / Quality Escape / Quality Escape Item /
 * Product & Delivery, then leaves the browser open for the user to look
 * at. "Confirm" doesn't click "Upload to SAP" yet (not implemented — see
 * desktop/d365-automation/d365_order_cli.py) — it's a placeholder that
 * just tells the automation process the user is ready, and the log
 * reminds the user to click that button themselves in the still-open
 * window. "Discard" closes the automation browser without touching SAP.
 */
export function SpareOrderPanel() {
  const t = useTranslate(zh);
  const [available, setAvailable] = useState(false);
  const [payload, setPayload] = useState<D365OrderPayload>(DEFAULT_PAYLOAD);
  const [problemDescription, setProblemDescription] = useState("");
  const [stage, setStage] = useState<Stage>("form");
  const [workOrderId, setWorkOrderId] = useState<string | null>(null);
  const [log, setLog] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isD365OrderAvailable()) return;
    setAvailable(true);
    return onD365OrderLog((line) => {
      setLog((prev) => `${prev}${line}\n`);
    });
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  function updateSection<K extends keyof D365OrderPayload>(
    section: K,
    field: keyof D365OrderPayload[K],
    value: string
  ) {
    setPayload((prev) => ({ ...prev, [section]: { ...prev[section], [field]: value } }));
  }

  function handleProblemDescriptionChange(value: string) {
    setProblemDescription(value);
    setPayload((prev) => ({
      ...prev,
      workOrder: { ...prev.workOrder, description: value, reportedProblemDetail: value },
      qualityEscape: { ...prev.qualityEscape, problemDescription: value },
    }));
  }

  async function handleFill() {
    setStage("filling");
    setLog((prev) => `${prev}\n=== ${t("Fill D365 Form")} ===\n`);
    try {
      const result = await fillD365Form(payload);
      setWorkOrderId(result.workOrderId);
      setStage("review");
      setLog((prev) => `${prev}${t("Everything is filled in — review the Edge window, then either confirm or discard.")}\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLog((prev) => `${prev}[Error] ${message}\n`);
      setStage("form");
    }
  }

  async function handleConfirm() {
    try {
      await confirmD365Submit();
      setLog((prev) => `${prev}${t('Automated submission isn\'t implemented yet — after confirming, please click "Upload to SAP" yourself in the still-open Edge window.')}\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLog((prev) => `${prev}[Error] ${message}\n`);
    }
  }

  async function handleDiscard() {
    await cancelD365Order();
    setStage("form");
    setWorkOrderId(null);
  }

  function startNewOrder() {
    setPayload(DEFAULT_PAYLOAD);
    setProblemDescription("");
    setStage("form");
    setWorkOrderId(null);
  }

  if (!available) {
    return (
      <Card className="mb-6">
        <CardContent className="text-muted-foreground text-sm">
          {t("Desktop app only — open this page inside the lambom desktop app to use this tool.")}
        </CardContent>
      </Card>
    );
  }

  const disabled = stage !== "form";

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="grid gap-1.5">
          <Label>{t("Problem Description")}</Label>
          <Textarea
            value={problemDescription}
            onChange={(e) => handleProblemDescriptionChange(e.target.value)}
            disabled={disabled}
            rows={2}
          />
          <p className="text-muted-foreground text-xs">
            {t(
              "Shared as the starting text for Work Order Description, Reported Problem Detail, and the Quality Escape Problem Description — edit any of those individually afterward if needed."
            )}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Work Order")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>{t("Installation?")}</Label>
            <Input
              value={payload.workOrder.installation}
              onChange={(e) => updateSection("workOrder", "installation", e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("Service Type")}</Label>
            <Input
              value={payload.workOrder.serviceType}
              onChange={(e) => updateSection("workOrder", "serviceType", e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("FID (Customer Asset)")}</Label>
            <Input
              value={payload.workOrder.fid}
              onChange={(e) => updateSection("workOrder", "fid", e.target.value)}
              placeholder={t("e.g. 255711")}
              disabled={disabled}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("Chamber (only needed if this FID has multiple chambers)")}</Label>
            <Input
              value={payload.workOrder.chamber}
              onChange={(e) => updateSection("workOrder", "chamber", e.target.value)}
              placeholder={t("e.g. PM1")}
              disabled={disabled}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("SEMI E10 Asset State")}</Label>
            <Input
              value={payload.workOrder.e10AssetState}
              onChange={(e) => updateSection("workOrder", "e10AssetState", e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("SEMI E10 Asset Substatus")}</Label>
            <Input
              value={payload.workOrder.e10AssetSubstatus}
              onChange={(e) => updateSection("workOrder", "e10AssetSubstatus", e.target.value)}
              disabled={disabled}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Quality Escape")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>{t("Customer Temperature")}</Label>
            <Input
              value={payload.qualityEscape.customerTemperature}
              onChange={(e) => updateSection("qualityEscape", "customerTemperature", e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("Are Wafers Scrapped?")}</Label>
            <Input
              value={payload.qualityEscape.wafersScrapped}
              onChange={(e) => updateSection("qualityEscape", "wafersScrapped", e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("Customer Tracking Type")}</Label>
            <Input
              value={payload.qualityEscape.customerTrackingType}
              onChange={(e) => updateSection("qualityEscape", "customerTrackingType", e.target.value)}
              disabled={disabled}
            />
            <p className="text-muted-foreground text-xs">
              {t("(leave blank to leave unset, matching the recorded default)")}
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label>{t("Safety Issue?")}</Label>
            <Input
              value={payload.qualityEscape.safetyIssue}
              onChange={(e) => updateSection("qualityEscape", "safetyIssue", e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("Instl/Upgrd Commit Date")}</Label>
            <Input
              value={payload.qualityEscape.commitDate}
              onChange={(e) => updateSection("qualityEscape", "commitDate", e.target.value)}
              disabled={disabled}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Quality Escape Item")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>{t("What (Object) is causing the problem?")}</Label>
            <Input
              value={payload.qualityEscapeItem.causingProblem}
              onChange={(e) => updateSection("qualityEscapeItem", "causingProblem", e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("What is the deviation?")}</Label>
            <Input
              value={payload.qualityEscapeItem.deviation}
              onChange={(e) => updateSection("qualityEscapeItem", "deviation", e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("What is it supposed to be (Specification)?")}</Label>
            <Input
              value={payload.qualityEscapeItem.specification}
              onChange={(e) => updateSection("qualityEscapeItem", "specification", e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("Additional notes (optional)")}</Label>
            <Textarea
              value={payload.qualityEscapeItem.additionalNotes}
              onChange={(e) => updateSection("qualityEscapeItem", "additionalNotes", e.target.value)}
              disabled={disabled}
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Product / Delivery")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>{t("Part No.")}</Label>
            <Input
              value={payload.product.partNo}
              onChange={(e) => updateSection("product", "partNo", e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("Priority Code")}</Label>
            <Input
              value={payload.product.priorityCode}
              onChange={(e) => updateSection("product", "priorityCode", e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("Delivery Date")}</Label>
            <Input
              type="date"
              value={payload.product.deliveryDate}
              onChange={(e) => updateSection("product", "deliveryDate", e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("Delivery Time")}</Label>
            <Input
              type="time"
              value={payload.product.deliveryTime}
              onChange={(e) => updateSection("product", "deliveryTime", e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("Location / Dock")}</Label>
            <Input
              value={payload.product.location}
              onChange={(e) => updateSection("product", "location", e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("Contact Name")}</Label>
            <Input
              value={payload.product.contactName}
              onChange={(e) => updateSection("product", "contactName", e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("Contact Phone")}</Label>
            <Input
              value={payload.product.contactPhone}
              onChange={(e) => updateSection("product", "contactPhone", e.target.value)}
              disabled={disabled}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          {stage === "form" && (
            <Button onClick={handleFill} disabled={!payload.product.partNo.trim()}>
              <Send className="h-4 w-4" />
              {t("Fill D365 Form")}
            </Button>
          )}
          {stage === "filling" && (
            <Button disabled>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("Filling…")}
            </Button>
          )}
          {stage === "review" && (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleConfirm}>
                <Send className="h-4 w-4" />
                {t("Confirm")}
              </Button>
              <Button variant="destructive" onClick={handleDiscard}>
                <XIcon className="h-4 w-4" />
                {t("Discard")}
              </Button>
              {workOrderId && <Button variant="ghost" onClick={startNewOrder}>{t("Start a new order")}</Button>}
            </div>
          )}

          <div
            ref={logRef}
            className="mt-3 h-48 overflow-y-auto rounded-md bg-neutral-900 p-2 font-mono text-xs whitespace-pre-wrap text-neutral-200"
          >
            {log}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
