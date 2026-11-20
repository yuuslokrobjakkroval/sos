import { useNavigate } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { CommandText, LanguageSwitch, PageHeader, ThemeToggle } from "../components/Chrome";
import { useEngine } from "../engine/EngineProvider";
import { useI18n } from "../i18n/I18nProvider";
import { fill } from "../i18n/text";
import { useTheme, type ThemeChoice } from "../theme/ThemeProvider";

export default function SettingsPage() {
  const { dict } = useI18n();
  const { user, signOut } = useAuth();
  const { health, offline } = useEngine();
  const { choice, setChoice } = useTheme();
  const navigate = useNavigate();
  const choices: ThemeChoice[] = ["system", "light", "dark"];

  return (
    <div className="stack narrow">
      <PageHeader title={dict.settings.title} lead={dict.settings.lead} />
      <section className="card setting-block" id="account">
        <h2>{dict.settings.account}</h2>
        <p className="muted">{dict.settings.accountLead}</p>
        <dl className="account">
          <div>
            <dt>{dict.common.name}</dt>
            <dd>{user?.name}</dd>
          </div>
          <div>
            <dt>{dict.common.email}</dt>
            <dd>{user?.email}</dd>
          </div>
        </dl>
        <button
          type="button"
          className="btn danger"
          onClick={() => {
            void signOut().then(() => navigate("/"));
          }}
        >
          {dict.nav.signOut}
        </button>
      </section>
      <section className="card setting-block">
        <h2>{dict.settings.appearance}</h2>
        <p className="muted">{dict.settings.appearanceLead}</p>
        <div className="setting-row">
          <span>{dict.lang.label}</span>
          <LanguageSwitch />
        </div>
        <fieldset className="choice-row">
          <legend>{dict.theme.label}</legend>
          {choices.map((item) => (
            <label key={item} className={choice === item ? "selected" : ""}>
              <input
                type="radio"
                name="theme"
                value={item}
                checked={choice === item}
                onChange={() => setChoice(item)}
              />
              {dict.theme[item]}
            </label>
          ))}
        </fieldset>
        <div className="setting-row">
          <span>{dict.theme.toggleToDark}</span>
          <ThemeToggle />
        </div>
      </section>
      <section className="card setting-block">
        <h2>{dict.settings.engine}</h2>
        <p className="muted">{dict.settings.engineLead}</p>
        {offline && !health && (
          <p className="field-error">
            <CommandText template={dict.engine.offline} command="npm run server" />
          </p>
        )}
        {health && (
          <ul className="engine-list">
            <EngineRow label={dict.settings.ffmpeg} ok={health.ffmpeg} present={dict.settings.present} missing={dict.settings.missing} />
            <EngineRow label={dict.settings.whisper} ok={health.whisper} present={dict.settings.present} missing={dict.settings.missing} />
            <EngineRow
              label={dict.settings.model}
              ok={health.model}
              present={health.model_name ?? dict.settings.present}
              missing={dict.settings.missing}
            />
            <EngineRow
              label={dict.settings.vision}
              ok={health.vision}
              present={health.vision_model ?? dict.settings.present}
              missing={dict.settings.missing}
            />
          </ul>
        )}
        {health && <p className="muted">{fill(dict.settings.maxUpload, { mb: health.max_upload_mb })}</p>}
        {!health && !offline && <p className="muted">{dict.common.loading}</p>}
      </section>
      <section className="card setting-block">
        <h2>{dict.settings.about}</h2>
        <p>{dict.settings.aboutBody}</p>
      </section>
    </div>
  );
}

function EngineRow({
  label,
  ok,
  present,
  missing,
}: {
  label: string;
  ok: boolean;
  present: string;
  missing: string;
}) {
  return (
    <li>
      <span>{label}</span>
      <strong className={ok ? "ok" : "warn"}>{ok ? present : missing}</strong>
    </li>
  );
}
