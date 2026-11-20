import type { ReactNode } from "react";
import { Link } from "react-router";
import { Moon01Icon, Sun01Icon } from "@hugeicons/core-free-icons";
import { AppIcon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/i18n/I18nProvider";
import type { Locale } from "@/i18n/types";
import { useTheme } from "@/theme/ThemeProvider";

export function BrandLink({ to = "/" }: { to?: string }) {
  const { dict } = useI18n();
  return (
    <Link to={to} className="flex min-w-0 items-center gap-2 text-inherit no-underline">
      <img src="/icon.svg" alt="" width={32} height={32} />
      <span className="flex min-w-0 flex-col leading-tight">
        <strong className="font-heading text-base">{dict.brand}</strong>
        <small className="text-xs text-muted-foreground">{dict.brandTag}</small>
      </span>
    </Link>
  );
}

export function LanguageSelect() {
  const { locale, setLocale, dict } = useI18n();
  return (
    <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
      <SelectTrigger aria-label={dict.lang.label} className="w-[9.5rem]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="en">English</SelectItem>
        <SelectItem value="km">ភាសាខ្មែរ</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function ThemeToggle() {
  const { resolved, setChoice } = useTheme();
  const { dict } = useI18n();
  const toDark = resolved === "light";
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={toDark ? dict.theme.toggleToDark : dict.theme.toggleToLight}
      onClick={() => setChoice(toDark ? "dark" : "light")}
    >
      <AppIcon icon={resolved === "dark" ? Sun01Icon : Moon01Icon} />
    </Button>
  );
}

export function PageHeader({
  title,
  lead,
  action,
}: {
  title: string;
  lead?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-heading text-3xl leading-tight wrap-break-word">{title}</h1>
        {lead && <p className="mt-1 max-w-prose text-muted-foreground">{lead}</p>}
      </div>
      {action}
    </header>
  );
}
