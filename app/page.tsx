"use client";

import { useState } from "react";
import Link from "next/link";
import { Boxes, ClipboardList, Settings } from "lucide-react";
import { useEmployeeGroup } from "@/lib/groups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
];

function EmployeeIdBar() {
  const { employeeId, group, loading, notFound, setEmployeeId } = useEmployeeGroup();
  const [draft, setDraft] = useState("");

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
          placeholder="工號"
          className="h-9 w-32"
        />
        <Button size="sm" disabled={!draft.trim()} onClick={() => setEmployeeId(draft.trim())}>
          確認
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      {notFound ? (
        <span className="text-destructive">工號 {employeeId} 尚未加入任何群組,請聯絡管理員在編輯群組加入</span>
      ) : (
        <span>
          {group?.name} · 工號 {employeeId}
        </span>
      )}
      <Button variant="ghost" size="sm" onClick={() => setEmployeeId(null)}>
        更換
      </Button>
    </div>
  );
}

export default function Home() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <div className="absolute right-4 top-4 flex items-center gap-3">
        <EmployeeIdBar />
        <Button variant="outline" size="icon" asChild>
          <Link href="/groups" aria-label="編輯群組">
            <Settings className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="flex flex-col items-center">
        <h1 className="mb-10 text-xl font-medium text-muted-foreground">Internal Tools</h1>
        <div className="grid grid-cols-2 gap-8 sm:gap-12">
          {apps.map(({ href, label, description, icon: Icon, gradient }) => (
            <Link
              key={href}
              href={href}
              className="group flex flex-col items-center gap-3 rounded-2xl p-2 transition-transform duration-150 ease-out hover:scale-105 focus-visible:scale-105 focus-visible:outline-none"
            >
              <div
                className={`flex h-24 w-24 items-center justify-center rounded-[22px] bg-gradient-to-br sm:h-28 sm:w-28 ${gradient} shadow-lg shadow-black/10 transition-shadow duration-150 group-hover:shadow-xl group-hover:shadow-black/20`}
              >
                <Icon className="h-11 w-11 text-white sm:h-12 sm:w-12" strokeWidth={1.75} />
              </div>
              <div className="text-center">
                <div className="text-sm font-semibold text-foreground">{label}</div>
                <div className="text-xs text-muted-foreground">{description}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
