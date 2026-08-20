"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTranslate } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SpareOrderPanel } from "@/components/spare-order-panel";

const zh: Record<string, string> = {
  "Spare Part Order": "訂料自動化",
  "Fills in the D365 Work Order / Quality Escape / Product form for you, then stops for review before anything is uploaded to SAP.":
    "自動幫你填好 D365 的 Work Order / Quality Escape / 料號表單,填完會停下來讓你檢查,確認前不會送到 SAP。",
  "Back to Home": "回首頁",
};

export default function SpareOrderPage() {
  const t = useTranslate(zh);

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("Spare Part Order")}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t(
                "Fills in the D365 Work Order / Quality Escape / Product form for you, then stops for review before anything is uploaded to SAP."
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Button variant="outline" size="icon" asChild aria-label={t("Back to Home")}>
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        <SpareOrderPanel />
      </div>
    </div>
  );
}
