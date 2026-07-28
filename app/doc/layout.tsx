import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "File Replace",
  description: "View and replace the file stored in Supabase Storage",
};

export default function DocLayout({ children }: { children: React.ReactNode }) {
  return children;
}
