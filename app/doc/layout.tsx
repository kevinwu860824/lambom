import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "File Replace",
  description: "View and replace the stored file",
};

export default function DocLayout({ children }: { children: React.ReactNode }) {
  return children;
}
