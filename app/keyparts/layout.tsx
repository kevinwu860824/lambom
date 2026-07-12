import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "重要零件追蹤",
  description: "標記關鍵零件,比對新機台是否被改料號",
};

export default function KeyPartsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
