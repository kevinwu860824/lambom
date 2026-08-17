"use client";

import { Check, Globe } from "lucide-react";
import { useLocale, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const OPTIONS: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh-TW", label: "繁體中文" },
];

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Change language">
          <Globe className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-40 p-1">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setLocale(opt.value)}
            className={cn(
              "hover:bg-accent flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm",
              locale === opt.value && "font-medium"
            )}
          >
            {opt.label}
            {locale === opt.value && <Check className="h-3.5 w-3.5" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
