import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LamBOM - BOM Comparison Tool",
  description: "Select two machine BOMs to compare their differences",
};

export default function LambomLayout({ children }: { children: React.ReactNode }) {
  return children;
}
