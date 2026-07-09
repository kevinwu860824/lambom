import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "檔案取代",
  description: "檢視並取代 Supabase Storage 中儲存的檔案",
};

export default function DocLayout({ children }: { children: React.ReactNode }) {
  return children;
}
