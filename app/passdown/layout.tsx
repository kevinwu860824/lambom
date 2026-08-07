import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Passdown Tool",
  description: "F22 VXT daily shift handover board",
};

export default function PassdownLayout({ children }: { children: React.ReactNode }) {
  return children;
}
