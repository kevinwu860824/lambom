import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Data Editor",
  description: "View and replace the content of Supabase's Data table",
};

export default function DataLayout({ children }: { children: React.ReactNode }) {
  return children;
}
