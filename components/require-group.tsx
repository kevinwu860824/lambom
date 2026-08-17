"use client";

import Link from "next/link";
import { useTranslate } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

const zh: Record<string, string> = {
  "Back to Home": "回首頁",
  "Employee ID {id} hasn't been added to any group yet — contact an admin to add it under Edit Groups.":
    "工號 {id} 尚未加入任何群組,請聯絡管理員在編輯群組加入。",
  "Please go back to the home page and enter your employee ID first, so we can show the machines your group has access to.":
    "請先回首頁輸入工號,才能看到你群組擁有的機台。",
};

/** Shown in place of a page's machine picker/list when the current browser
 * hasn't resolved a group yet — either no employee ID saved at all, or one
 * that isn't a member of any group. See lib/groups.ts's useEmployeeGroup. */
export function RequireGroupPrompt({
  notFound,
  employeeId,
}: {
  notFound: boolean;
  employeeId: string | null;
}) {
  const t = useTranslate(zh);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-muted-foreground">
        {notFound
          ? t("Employee ID {id} hasn't been added to any group yet — contact an admin to add it under Edit Groups.").replace(
              "{id}",
              employeeId ?? ""
            )
          : t("Please go back to the home page and enter your employee ID first, so we can show the machines your group has access to.")}
      </p>
      <Button variant="outline" asChild>
        <Link href="/">{t("Back to Home")}</Link>
      </Button>
    </div>
  );
}
