import { useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { EyeIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { z } from "zod";
import { useAuth } from "@/auth/AuthProvider";
import { AuthError } from "@/auth/types";
import { AppIcon } from "@/components/icon";
import { BrandLink, LanguageSelect, ThemeToggle } from "@/components/preferences";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/I18nProvider";
import type { Dictionary } from "@/i18n/types";

function AuthLayout({ children }: { children: ReactNode }) {
  const { dict } = useI18n();
  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(280px,0.9fr)_1.1fr]">
      <aside className="hidden flex-col justify-between bg-sidebar p-8 text-sidebar-foreground lg:flex">
        <BrandLink />
        <div>
          <p className="max-w-[14ch] font-heading text-4xl leading-tight">{dict.auth.panelTitle}</p>
          <p className="mt-3 max-w-sm text-sidebar-foreground/70">{dict.auth.panelBody}</p>
        </div>
      </aside>
      <main id="main" className="flex flex-col px-4 py-6">
        <div className="flex items-center justify-between gap-2">
          <span className="lg:hidden"><BrandLink /></span>
          <span className="ml-auto flex items-center gap-2">
            <LanguageSelect />
            <ThemeToggle />
          </span>
        </div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-8">
          <Alert className="mb-4">
            <AlertDescription>{dict.auth.demoNote}</AlertDescription>
          </Alert>
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

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-sm text-destructive" role="alert">{message}</p>;
}

function PasswordInput({
  id,
  label,
  autoComplete,
  error,
  registration,
}: {
  id: string;
  label: string;
  autoComplete: string;
  error?: string;
  registration: React.InputHTMLAttributes<HTMLInputElement>;
}) {
  const { dict } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input id={id} type={visible ? "text" : "password"} autoComplete={autoComplete} aria-invalid={error ? true : undefined} className="pr-12" {...registration} />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-1/2 right-1 -translate-y-1/2"
          aria-pressed={visible}
          aria-label={visible ? dict.common.hidePassword : dict.common.showPassword}
          onClick={() => setVisible((value) => !value)}
        >
          <AppIcon icon={visible ? ViewOffIcon : EyeIcon} />
        </Button>
      </div>
      <FieldError message={error} />
    </div>
  );
}

export function SignInPage() {
  const { dict, locale } = useI18n();
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const schema = z.object({
    email: z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, dict.auth.errors.email),
    password: z.string().min(1, dict.auth.errors.password),
    remember: z.boolean(),
  });
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "", remember: false },
  });
  const [formError, setFormError] = useState("");

  return (
    <AuthLayout key={locale}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{dict.auth.signInTitle}</CardTitle>
          <CardDescription>{dict.auth.signInLead}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            noValidate
            onSubmit={form.handleSubmit(async (values) => {
              setFormError("");
              try {
                await signIn(values);
                navigate(destination(location.state), { replace: true });
              } catch (error) {
                setFormError(message(dict, error));
              }
            })}
          >
            {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}
            <div className="grid gap-2">
              <Label htmlFor="email">{dict.common.email}</Label>
              <Input id="email" type="email" autoComplete="email" aria-invalid={!!form.formState.errors.email} {...form.register("email")} />
              <FieldError message={form.formState.errors.email?.message} />
            </div>
            <PasswordInput
              id="password"
              label={dict.common.password}
              autoComplete="current-password"
              error={form.formState.errors.password?.message}
              registration={form.register("password")}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="min-h-10 font-normal">
                <Checkbox checked={form.watch("remember")} onCheckedChange={(value) => form.setValue("remember", value === true)} />
                {dict.auth.remember}
              </Label>
              <Link to="/forgot-password" className="text-sm underline-offset-4 hover:underline">{dict.auth.forgotLink}</Link>
            </div>
            <Button type="submit" disabled={form.formState.isSubmitting}>{dict.auth.signInSubmit}</Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground">
            {dict.auth.noAccount}{" "}
            <Link to="/signup" state={location.state} className="text-foreground underline-offset-4 hover:underline">{dict.auth.createAccount}</Link>
          </p>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}

export function SignUpPage() {
  const { dict, locale } = useI18n();
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const schema = z
    .object({
      name: z.string().trim().min(2, dict.auth.errors.name),
      email: z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, dict.auth.errors.email),
      password: z.string().min(8, dict.auth.errors.password),
      confirm: z.string().min(1, dict.auth.errors.confirm),
    })
    .refine((value) => value.password === value.confirm, { path: ["confirm"], message: dict.auth.errors.mismatch });
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", password: "", confirm: "" },
  });

  return (
    <AuthLayout key={locale}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{dict.auth.signUpTitle}</CardTitle>
          <CardDescription>{dict.auth.signUpLead}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            noValidate
            onSubmit={form.handleSubmit(async (values) => {
              try {
                await signUp(values);
                navigate(destination(location.state), { replace: true });
              } catch (error) {
                if (error instanceof AuthError && error.code === "taken") form.setError("email", { message: dict.auth.errors.taken });
                else form.setError("root", { message: message(dict, error) });
              }
            })}
          >
            {form.formState.errors.root && <p className="text-sm text-destructive" role="alert">{form.formState.errors.root.message}</p>}
            <div className="grid gap-2">
              <Label htmlFor="name">{dict.common.name}</Label>
              <Input id="name" autoComplete="name" aria-invalid={!!form.formState.errors.name} {...form.register("name")} />
              <FieldError message={form.formState.errors.name?.message} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="signup-email">{dict.common.email}</Label>
              <Input id="signup-email" type="email" autoComplete="email" aria-invalid={!!form.formState.errors.email} {...form.register("email")} />
              <FieldError message={form.formState.errors.email?.message} />
            </div>
            <PasswordInput id="new-password" label={dict.common.password} autoComplete="new-password" error={form.formState.errors.password?.message} registration={form.register("password")} />
            <PasswordInput id="confirm-password" label={dict.common.confirmPassword} autoComplete="new-password" error={form.formState.errors.confirm?.message} registration={form.register("confirm")} />
            <Button type="submit" disabled={form.formState.isSubmitting}>{dict.auth.createAccount}</Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground">
            {dict.auth.hasAccount}{" "}
            <Link to="/signin" state={location.state} className="text-foreground underline-offset-4 hover:underline">{dict.nav.signIn}</Link>
          </p>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const { dict, locale } = useI18n();
  const { forgotPassword } = useAuth();
  const schema = z.object({
    email: z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, dict.auth.errors.email),
  });
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { email: "" } });
  const [done, setDone] = useState<{ demoResetUrl: string | null } | null>(null);

  return (
    <AuthLayout key={locale}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{done ? dict.auth.forgotSuccessTitle : dict.auth.forgotTitle}</CardTitle>
          <CardDescription>{done ? dict.auth.forgotSuccessBody : dict.auth.forgotLead}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {done ? (
            <>
              {done.demoResetUrl && (
                <Alert>
                  <AlertDescription>
                    {dict.auth.demoReset}{" "}
                    <Link to={done.demoResetUrl} className="underline">{dict.auth.resetTitle}</Link>
                  </AlertDescription>
                </Alert>
              )}
              <Button variant="outline" asChild><Link to="/signin">{dict.auth.backToSignIn}</Link></Button>
            </>
          ) : (
            <form
              className="grid gap-4"
              noValidate
              onSubmit={form.handleSubmit(async (values) => {
                setDone(await forgotPassword(values.email));
              })}
            >
              <div className="grid gap-2">
                <Label htmlFor="forgot-email">{dict.common.email}</Label>
                <Input id="forgot-email" type="email" autoComplete="email" aria-invalid={!!form.formState.errors.email} {...form.register("email")} />
                <FieldError message={form.formState.errors.email?.message} />
              </div>
              <Button type="submit" disabled={form.formState.isSubmitting}>{dict.auth.forgotSubmit}</Button>
              <Link to="/signin" className="text-sm text-muted-foreground underline-offset-4 hover:underline">{dict.auth.backToSignIn}</Link>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const { dict, locale } = useI18n();
  const { resetPassword } = useAuth();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const schema = z
    .object({
      password: z.string().min(8, dict.auth.errors.password),
      confirm: z.string().min(1, dict.auth.errors.confirm),
    })
    .refine((value) => value.password === value.confirm, { path: ["confirm"], message: dict.auth.errors.mismatch });
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { password: "", confirm: "" } });
  const [done, setDone] = useState(false);

  return (
    <AuthLayout key={locale}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{done ? dict.auth.resetSuccessTitle : dict.auth.resetTitle}</CardTitle>
          <CardDescription>{done ? dict.auth.resetSuccessBody : dict.auth.resetLead}</CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <Button asChild><Link to="/signin">{dict.nav.signIn}</Link></Button>
          ) : (
            <form
              className="grid gap-4"
              noValidate
              onSubmit={form.handleSubmit(async (values) => {
                try {
                  await resetPassword({ token, password: values.password });
                  setDone(true);
                } catch (error) {
                  form.setError("root", { message: message(dict, error) });
                }
              })}
            >
              {!token && <p className="text-sm text-destructive" role="alert">{dict.auth.invalidToken}</p>}
              {form.formState.errors.root && <p className="text-sm text-destructive" role="alert">{form.formState.errors.root.message}</p>}
              <PasswordInput id="reset-password" label={dict.common.password} autoComplete="new-password" error={form.formState.errors.password?.message} registration={form.register("password")} />
              <PasswordInput id="reset-confirm" label={dict.common.confirmPassword} autoComplete="new-password" error={form.formState.errors.confirm?.message} registration={form.register("confirm")} />
              <Button type="submit" disabled={form.formState.isSubmitting || !token}>{dict.auth.resetSubmit}</Button>
              <Link to="/forgot-password" className="text-sm text-muted-foreground underline-offset-4 hover:underline">{dict.auth.forgotTitle}</Link>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
