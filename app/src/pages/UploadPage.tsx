import { PageHeader } from "@/components/preferences";
import UploadPanel from "@/components/UploadPanel";
import { useI18n } from "@/i18n/I18nProvider";

export default function UploadPage() {
  const { dict } = useI18n();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageHeader title={dict.upload.title} lead={dict.upload.lead} />
      <UploadPanel />
    </div>
  );
}
