import Link from "next/link";
import { Boxes, ClipboardList } from "lucide-react";

const apps = [
  {
    href: "/lambom",
    label: "LamBOM",
    description: "BOM Comparison Tool",
    icon: Boxes,
    gradient: "from-sky-400 to-blue-600",
  },
  {
    href: "/passdown",
    label: "Passdown Tool",
    description: "F22 VXT Daily Passdown",
    icon: ClipboardList,
    gradient: "from-amber-400 to-orange-600",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="flex flex-col items-center">
        <h1 className="mb-10 text-xl font-medium text-muted-foreground">Internal Tools</h1>
        <div className="grid grid-cols-2 gap-8 sm:gap-12">
          {apps.map(({ href, label, description, icon: Icon, gradient }) => (
            <Link
              key={href}
              href={href}
              className="group flex flex-col items-center gap-3 rounded-2xl p-2 transition-transform duration-150 ease-out hover:scale-105 focus-visible:scale-105 focus-visible:outline-none"
            >
              <div
                className={`flex h-24 w-24 items-center justify-center rounded-[22px] bg-gradient-to-br sm:h-28 sm:w-28 ${gradient} shadow-lg shadow-black/10 transition-shadow duration-150 group-hover:shadow-xl group-hover:shadow-black/20`}
              >
                <Icon className="h-11 w-11 text-white sm:h-12 sm:w-12" strokeWidth={1.75} />
              </div>
              <div className="text-center">
                <div className="text-sm font-semibold text-foreground">{label}</div>
                <div className="text-xs text-muted-foreground">{description}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
