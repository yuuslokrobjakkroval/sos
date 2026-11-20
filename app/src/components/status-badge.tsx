import type { Status } from "@/api";
import { Badge } from "@/components/ui/badge";
import { isWorking } from "@/engine/status";
import { useI18n } from "@/i18n/I18nProvider";
import { statusText } from "@/i18n/text";

export function StatusBadge({ status, progress }: { status: Status; progress: number | null }) {
  const { dict } = useI18n();
  const tone =
    status === "done"
      ? "bg-emerald-600/15 text-emerald-800 dark:text-emerald-300"
      : status === "failed"
        ? "bg-destructive/15 text-destructive"
        : "bg-primary/15 text-primary";
  return (
    <Badge variant="outline" className={`border-transparent ${tone}`}>
      {isWorking(status) && (
        <span className="size-2.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
      )}
      {statusText(dict, status, progress)}
    </Badge>
  );
}
