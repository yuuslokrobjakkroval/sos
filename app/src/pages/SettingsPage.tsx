import { useNavigate } from "react-router";
import { useAuth } from "@/auth/AuthProvider";
import { LanguageSelect, PageHeader, ThemeToggle } from "@/components/preferences";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useEngine } from "@/engine/EngineProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { fill } from "@/i18n/text";
import { useTheme, type ThemeChoice } from "@/theme/ThemeProvider";

export default function SettingsPage() {
  const { dict } = useI18n();
  const { user, signOut } = useAuth();
  const { health, offline } = useEngine();
  const { choice, setChoice } = useTheme();
  const navigate = useNavigate();
  const choices: ThemeChoice[] = ["system", "light", "dark"];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageHeader title={dict.settings.title} lead={dict.settings.lead} />
      <Card id="account">
        <CardHeader>
          <CardTitle>{dict.settings.account}</CardTitle>
          <CardDescription>{dict.settings.accountLead}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div><dt className="text-sm text-muted-foreground">{dict.common.name}</dt><dd className="font-medium">{user?.name}</dd></div>
            <div><dt className="text-sm text-muted-foreground">{dict.common.email}</dt><dd className="font-medium wrap-break-word">{user?.email}</dd></div>
          </dl>
          <Button
            variant="destructive"
            className="w-fit"
            onClick={() => {
              void signOut().then(() => navigate("/"));
            }}
          >
            {dict.nav.signOut}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{dict.settings.appearance}</CardTitle>
          <CardDescription>{dict.settings.appearanceLead}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{dict.lang.label}</span>
            <LanguageSelect />
          </div>
          <RadioGroup value={choice} onValueChange={(value) => setChoice(value as ThemeChoice)} className="grid gap-2">
            <Label className="text-sm">{dict.theme.label}</Label>
            {choices.map((item) => (
              <Label key={item} className="min-h-10 w-fit rounded-lg border px-3 py-2 font-normal">
                <RadioGroupItem value={item} />
                {dict.theme[item]}
              </Label>
            ))}
          </RadioGroup>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">{dict.theme.toggleToDark}</span>
            <ThemeToggle />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{dict.settings.engine}</CardTitle>
          <CardDescription>{dict.settings.engineLead}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {offline && !health && (
            <Alert variant="destructive">
              <AlertDescription>{dict.engine.offline.replace("{command}", "npm run server")}</AlertDescription>
            </Alert>
          )}
          {health && (
            <ul className="grid gap-2 text-sm">
              <Row label={dict.settings.ffmpeg} ok={health.ffmpeg} present={dict.settings.present} missing={dict.settings.missing} />
              <Row label={dict.settings.whisper} ok={health.whisper} present={dict.settings.present} missing={dict.settings.missing} />
              <Row label={dict.settings.model} ok={health.model} present={health.model_name ?? dict.settings.present} missing={dict.settings.missing} />
              <Row label={dict.settings.vision} ok={health.vision} present={health.vision_model ?? dict.settings.present} missing={dict.settings.missing} />
            </ul>
          )}
          {health && <p className="text-sm text-muted-foreground">{fill(dict.settings.maxUpload, { mb: health.max_upload_mb })}</p>}
          {!health && !offline && <p className="text-sm text-muted-foreground">{dict.common.loading}</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{dict.settings.about}</CardTitle></CardHeader>
        <CardContent><p className="leading-relaxed">{dict.settings.aboutBody}</p></CardContent>
      </Card>
    </div>
  );
}

function Row({ label, ok, present, missing }: { label: string; ok: boolean; present: string; missing: string }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <strong className={ok ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>{ok ? present : missing}</strong>
    </li>
  );
}
