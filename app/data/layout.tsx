import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "資料編輯",
  description: "檢視並取代 Supabase Data 表的內容",
};

export default function DataLayout({ children }: { children: React.ReactNode }) {
  return children;
}
