import Link from "next/link";
import { Button } from "@/components/ui/button";

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
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-muted-foreground">
        {notFound
          ? `工號 ${employeeId} 尚未加入任何群組,請聯絡管理員在編輯群組加入。`
          : "請先回首頁輸入工號,才能看到你群組擁有的機台。"}
      </p>
      <Button variant="outline" asChild>
        <Link href="/">回首頁</Link>
      </Button>
    </div>
  );
}
