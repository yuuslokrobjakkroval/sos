import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { AuthError } from "../auth/types";
import { HomeLogo, LanguageSwitch, ThemeToggle } from "../components/Chrome";
import { PasswordField, TextField } from "../components/Fields";
import { useI18n } from "../i18n/I18nProvider";
import type { Dictionary } from "../i18n/types";

function AuthLayout({ children }: { children: ReactNode }) {
  const { dict } = useI18n();
  return (
    <div className="auth-shell">
      <a className="skip-link" href="#main">
        {dict.skip}
      </a>
      <aside className="auth-aside">
        <HomeLogo />
        <div>
          <p className="aside-title">{dict.auth.panelTitle}</p>
          <p>{dict.auth.panelBody}</p>
        </div>
      </aside>
      <main className="auth-main" id="main">
        <div className="auth-tools">
          <HomeLogo />
          <LanguageSwitch />
          <ThemeToggle />
        </div>
        <div className="auth-card">
          <p className="demo-note">{dict.auth.demoNote}</p>
          {children}
        </div>
      </main>
    </div>
  );
}

function destination(state: unknown): string {
  const from = (state as { from?: { pathname?: string; search?: string } } | null)?.from;
  if (from?.pathname?.startsWith("/app")) return `${from.pathname}${from.search ?? ""}`;
  return "/app";
}

function message(dict: Dictionary, error: unknown): string {
  if (error instanceof AuthError) return dict.auth.errors[error.code] ?? dict.auth.errors.generic;
  return dict.auth.errors.generic;
}

const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

export function SignInPage() {
  const { dict } = useI18n();
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    if (!validEmail(email)) next.email = dict.auth.errors.email;
    if (!password) next.password = dict.auth.errors.password;
    setErrors(next);
    if (next.email || next.password) return;
    setPending(true);
    try {
      await signIn({ email, password, remember });
      navigate(destination(location.state), { replace: true });
    } catch (error) {
      setErrors({ form: message(dict, error) });
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout>
      <h1>{dict.auth.signInTitle}</h1>
      <p className="muted">{dict.auth.signInLead}</p>
      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        {errors.form && (
          <p className="field-error" role="alert">
            {errors.form}
          </p>
        )}
        <TextField
          label={dict.common.email}
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          error={errors.email}
          onChange={setEmail}
        />
        <PasswordField
          label={dict.common.password}
          name="password"
          autoComplete="current-password"
          value={password}
          error={errors.password}
          onChange={setPassword}
        />
        <div className="form-row">
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            <span>{dict.auth.remember}</span>
          </label>
          <Link to="/forgot-password">{dict.auth.forgotLink}</Link>
        </div>
        <button className="btn primary full" type="submit" disabled={pending}>
          {dict.auth.signInSubmit}
        </button>
      </form>
      <p className="auth-switch">
        {dict.auth.noAccount} <Link to="/signup" state={location.state}>{dict.auth.createAccount}</Link>
      </p>
    </AuthLayout>
  );
}

export function SignUpPage() {
  const { dict } = useI18n();
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = dict.auth.errors.name;
    if (!validEmail(email)) next.email = dict.auth.errors.email;
    if (password.length < 8) next.password = dict.auth.errors.password;
    if (!confirm) next.confirm = dict.auth.errors.confirm;
    else if (confirm !== password) next.confirm = dict.auth.errors.mismatch;
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setPending(true);
    try {
      await signUp({ name, email, password });
      navigate(destination(location.state), { replace: true });
    } catch (error) {
      if (error instanceof AuthError && error.code === "taken") setErrors({ email: dict.auth.errors.taken });
      else setErrors({ form: message(dict, error) });
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout>
      <h1>{dict.auth.signUpTitle}</h1>
      <p className="muted">{dict.auth.signUpLead}</p>
      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        {errors.form && (
          <p className="field-error" role="alert">
            {errors.form}
          </p>
        )}
        <TextField label={dict.common.name} name="name" autoComplete="name" value={name} error={errors.name} onChange={setName} />
        <TextField
          label={dict.common.email}
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          error={errors.email}
          onChange={setEmail}
        />
        <PasswordField
          label={dict.common.password}
          name="new-password"
          autoComplete="new-password"
          value={password}
          error={errors.password}
          onChange={setPassword}
        />
        <PasswordField
          label={dict.common.confirmPassword}
          name="confirm-password"
          autoComplete="new-password"
          value={confirm}
          error={errors.confirm}
          onChange={setConfirm}
        />
        <button className="btn primary full" type="submit" disabled={pending}>
          {dict.auth.createAccount}
        </button>
      </form>
      <p className="auth-switch">
        {dict.auth.hasAccount} <Link to="/signin" state={location.state}>{dict.nav.signIn}</Link>
      </p>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const { dict } = useI18n();
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<{ demoResetUrl: string | null } | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!validEmail(email)) {
      setError(dict.auth.errors.email);
      return;
    }
    setError("");
    setPending(true);
    try {
      setDone(await forgotPassword(email));
    } catch (caught) {
      setError(message(dict, caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout>
      {done ? (
        <>
          <h1>{dict.auth.forgotSuccessTitle}</h1>
          <p>{dict.auth.forgotSuccessBody}</p>
          {done.demoResetUrl && (
            <p className="demo-note">
              {dict.auth.demoReset}{" "}
              <Link to={done.demoResetUrl}>{dict.auth.resetTitle}</Link>
            </p>
          )}
          <Link className="btn" to="/signin">
            {dict.auth.backToSignIn}
          </Link>
        </>
      ) : (
        <>
          <h1>{dict.auth.forgotTitle}</h1>
          <p className="muted">{dict.auth.forgotLead}</p>
          <form onSubmit={(event) => void onSubmit(event)} noValidate>
            <TextField
              label={dict.common.email}
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              error={error}
              onChange={setEmail}
            />
            <button className="btn primary full" type="submit" disabled={pending}>
              {dict.auth.forgotSubmit}
            </button>
          </form>
          <p className="auth-switch">
            <Link to="/signin">{dict.auth.backToSignIn}</Link>
          </p>
        </>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const { dict } = useI18n();
  const { resetPassword } = useAuth();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (password.length < 8) next.password = dict.auth.errors.password;
    if (!confirm) next.confirm = dict.auth.errors.confirm;
    else if (confirm !== password) next.confirm = dict.auth.errors.mismatch;
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setPending(true);
    try {
      await resetPassword({ token, password });
      setDone(true);
    } catch (error) {
      setErrors({ form: message(dict, error) });
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout>
      {done ? (
        <>
          <h1>{dict.auth.resetSuccessTitle}</h1>
          <p>{dict.auth.resetSuccessBody}</p>
          <Link className="btn primary" to="/signin">
            {dict.nav.signIn}
          </Link>
        </>
      ) : (
        <>
          <h1>{dict.auth.resetTitle}</h1>
          <p className="muted">{dict.auth.resetLead}</p>
          {!token && (
            <p className="field-error" role="alert">
              {dict.auth.invalidToken}
            </p>
          )}
          <form onSubmit={(event) => void onSubmit(event)} noValidate>
            {errors.form && (
              <p className="field-error" role="alert">
                {errors.form}
              </p>
            )}
            <PasswordField
              label={dict.common.password}
              autoComplete="new-password"
              value={password}
              error={errors.password}
              onChange={setPassword}
            />
            <PasswordField
              label={dict.common.confirmPassword}
              autoComplete="new-password"
              value={confirm}
              error={errors.confirm}
              onChange={setConfirm}
            />
            <button className="btn primary full" type="submit" disabled={pending || !token}>
              {dict.auth.resetSubmit}
            </button>
          </form>
          <p className="auth-switch">
            <Link to="/forgot-password">{dict.auth.forgotTitle}</Link>
          </p>
        </>
      )}
    </AuthLayout>
  );
}
