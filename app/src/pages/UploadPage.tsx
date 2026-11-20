import { PageHeader } from "../components/Chrome";
import UploadPanel from "../components/UploadPanel";
import { useI18n } from "../i18n/I18nProvider";

export default function UploadPage() {
  const { dict } = useI18n();
  return (
    <div className="stack narrow">
      <PageHeader title={dict.upload.title} lead={dict.upload.lead} />
      <UploadPanel />
    </div>
  );
}
