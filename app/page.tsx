"use client";

import { useState } from "react";
import Link from "next/link";
import { Boxes, ClipboardList, Package, Settings } from "lucide-react";
import { useEmployeeGroup, type Group } from "@/lib/groups";
import { useTranslate } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LanguageSwitcher } from "@/components/language-switcher";

const zh: Record<string, string> = {
  "Employee ID": "工號",
  Confirm: "確認",
  Change: "更換",
  "{group} · Employee ID {id}": "{group} · 工號 {id}",
  "Employee ID {id} hasn't been added to any group yet — contact an admin to add it under Edit Groups":
    "工號 {id} 尚未加入任何群組,請聯絡管理員在編輯群組加入",
  "Edit Groups": "編輯群組",
  "Internal Tools": "內部工具",
  "Please enter your employee ID in the top-right corner first to access the tools below":
    "請先在右上角輸入工號,才能進入以下工具",
  "Please enter your employee ID first": "請先輸入工號",
  "BOM Comparison Tool": "BOM 比對工具",
  "F22 VXT Daily Passdown": "F22 VXT 交接紀錄",
  "D365 Order Automation": "D365 訂料自動化",
};

const apps = [
  {
    href: "/lambom",
    label: "LamBOM",
    description: "BOM Comparison Tool",
    icon: Boxes,
    gradient: "from-sky-400 to-blue-600",
  },
  {
    href: "/passdown",
    label: "Passdown Tool",
    description: "F22 VXT Daily Passdown",
    icon: ClipboardList,
    gradient: "from-amber-400 to-orange-600",
  },
  {
    href: "/spare-order",
    label: "Spare Order",
    description: "D365 Order Automation",
    icon: Package,
    gradient: "from-emerald-400 to-teal-600",
  },
];

function EmployeeIdBar({
  employeeId,
  group,
  loading,
  notFound,
  setEmployeeId,
}: {
  employeeId: string | null;
  group: Group | null;
  loading: boolean;
  notFound: boolean;
  setEmployeeId: (id: string | null) => void;
}) {
  const [draft, setDraft] = useState("");
  const t = useTranslate(zh);

  if (loading) return <div className="h-9" />;

  if (!employeeId) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) setEmployeeId(draft.trim());
          }}
          placeholder={t("Employee ID")}
          className="h-9 w-32"
        />
        <Button size="sm" disabled={!draft.trim()} onClick={() => setEmployeeId(draft.trim())}>
          {t("Confirm")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      {notFound ? (
        <span className="text-destructive">
          {t("Employee ID {id} hasn't been added to any group yet — contact an admin to add it under Edit Groups").replace(
            "{id}",
            employeeId ?? ""
          )}
        </span>
      ) : (
        <span>
          {t("{group} · Employee ID {id}")
            .replace("{group}", group?.name ?? "")
            .replace("{id}", employeeId ?? "")}
        </span>
      )}
      <Button variant="ghost" size="sm" onClick={() => setEmployeeId(null)}>
        {t("Change")}
      </Button>
    </div>
  );
}

export default function Home() {
  const { employeeId, group, loading, notFound, setEmployeeId } = useEmployeeGroup();
  const t = useTranslate(zh);
  const locked = !loading && !employeeId;

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <div className="absolute right-4 top-4 flex items-center gap-3">
        <EmployeeIdBar
          employeeId={employeeId}
          group={group}
          loading={loading}
          notFound={notFound}
          setEmployeeId={setEmployeeId}
        />
        <LanguageSwitcher />
        <Button variant="outline" size="icon" asChild>
          <Link href="/groups" aria-label={t("Edit Groups")}>
            <Settings className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="flex flex-col items-center">
        <h1 className="mb-10 text-xl font-medium text-muted-foreground">{t("Internal Tools")}</h1>
        {locked && (
          <p className="mb-4 text-sm text-muted-foreground">
            {t("Please enter your employee ID in the top-right corner first to access the tools below")}
          </p>
        )}
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 sm:gap-12">
          {apps.map(({ href, label, description, icon: Icon, gradient }) => {
            const tile = (
              <>
                <div
                  className={`flex h-24 w-24 items-center justify-center rounded-[22px] bg-gradient-to-br sm:h-28 sm:w-28 ${gradient} shadow-lg shadow-black/10 transition-shadow duration-150 ${locked ? "" : "group-hover:shadow-xl group-hover:shadow-black/20"}`}
                >
                  <Icon className="h-11 w-11 text-white sm:h-12 sm:w-12" strokeWidth={1.75} />
                </div>
                <div className="text-center">
                  <div className="text-sm font-semibold text-foreground">{label}</div>
                  <div className="text-xs text-muted-foreground">{t(description)}</div>
                </div>
              </>
            );

            if (locked) {
              return (
                <div
                  key={href}
                  className="group flex cursor-not-allowed flex-col items-center gap-3 rounded-2xl p-2 opacity-40"
                  title={t("Please enter your employee ID first")}
                >
                  {tile}
                </div>
              );
            }

            return (
              <Link
                key={href}
                href={href}
                className="group flex flex-col items-center gap-3 rounded-2xl p-2 transition-transform duration-150 ease-out hover:scale-105 focus-visible:scale-105 focus-visible:outline-none"
              >
                {tile}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
