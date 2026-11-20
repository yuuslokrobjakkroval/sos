import { useState } from "react";
import { Link } from "react-router";
import {
  ClosedCaptionIcon,
  DashboardSpeed01Icon,
  Download01Icon,
  Globe02Icon,
  LockIcon,
  Menu01Icon,
  Mic01Icon,
  PlayIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { AppIcon } from "@/components/icon";
import { BrandLink, LanguageSelect, ThemeToggle } from "@/components/preferences";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useI18n } from "@/i18n/I18nProvider";

const FEATURE_ICONS: IconSvgElement[] = [
  Mic01Icon,
  ClosedCaptionIcon,
  DashboardSpeed01Icon,
  Download01Icon,
  Globe02Icon,
  LockIcon,
];

export default function HomePage() {
  const { dict } = useI18n();
  const [open, setOpen] = useState(false);
  const year = new Date().getFullYear();

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col px-4">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">
        {dict.skip}
      </a>
      <header className="flex flex-wrap items-center gap-3 py-4">
        <BrandLink />
        <nav className="ml-auto hidden items-center gap-2 md:flex" aria-label={dict.nav.primary}>
          <a href="#features" className="rounded-md px-3 py-2 text-sm font-medium">{dict.nav.features}</a>
          <a href="#how" className="rounded-md px-3 py-2 text-sm font-medium">{dict.nav.how}</a>
          <Button variant="outline" asChild><Link to="/signin">{dict.nav.signIn}</Link></Button>
          <Button asChild><Link to="/signup">{dict.nav.signUp}</Link></Button>
        </nav>
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <LanguageSelect />
          <ThemeToggle />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="md:hidden" aria-label={dict.common.openMenu}>
                <AppIcon icon={Menu01Icon} />
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>{dict.brand}</SheetTitle>
              </SheetHeader>
              <div className="flex flex-col gap-2 px-4">
                <a href="#features" onClick={() => setOpen(false)} className="py-2">{dict.nav.features}</a>
                <a href="#how" onClick={() => setOpen(false)} className="py-2">{dict.nav.how}</a>
                <Button variant="outline" asChild><Link to="/signin" onClick={() => setOpen(false)}>{dict.nav.signIn}</Link></Button>
                <Button asChild><Link to="/signup" onClick={() => setOpen(false)}>{dict.nav.signUp}</Link></Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>
      <main id="main" className="flex flex-1 flex-col gap-16 pb-10">
        <section className="grid items-center gap-8 py-6 lg:grid-cols-2">
          <div>
            <p className="text-sm font-semibold text-primary">{dict.home.eyebrow}</p>
            <h1 className="mt-3 max-w-[12ch] font-heading text-5xl leading-tight md:text-6xl">{dict.home.title}</h1>
            <p className="mt-4 max-w-prose text-lg text-muted-foreground">{dict.home.lead}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button size="lg" asChild><Link to="/signup">{dict.home.ctaSignUp}</Link></Button>
              <Button size="lg" variant="outline" asChild><Link to="/signin">{dict.home.ctaSignIn}</Link></Button>
            </div>
          </div>
          <Card className="border-zinc-800 bg-zinc-950 text-zinc-50" aria-hidden>
            <CardHeader className="grid grid-cols-[auto_1fr_auto] items-center">
              <span className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground">
                <AppIcon icon={PlayIcon} size={16} />
              </span>
              <span className="text-sm text-zinc-400">{dict.home.stageBadge}</span>
              <Badge>{dict.pace.normal}</Badge>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {dict.home.sample.map((line, index) => (
                <div key={line.time} className={`grid grid-cols-[3rem_1fr_auto] gap-2 rounded-lg px-3 py-2 ${index === 1 ? "bg-white/10" : "bg-white/5"}`}>
                  <span className="text-primary">{line.time}</span>
                  <span>{line.text}</span>
                  <span className="text-sm text-zinc-400">{line.wpm}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
        <section id="features" className="grid gap-4">
          <div className="max-w-xl">
            <h2 className="font-heading text-3xl">{dict.home.featuresTitle}</h2>
            <p className="text-muted-foreground">{dict.home.featuresLead}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {dict.home.features.map((feature, index) => (
              <Card key={feature.title}>
                <CardHeader>
                  <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                    <AppIcon icon={FEATURE_ICONS[index] ?? PlayIcon} />
                  </span>
                  <CardTitle className="text-lg">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">{feature.body}</CardContent>
              </Card>
            ))}
          </div>
        </section>
        <section id="how" className="grid gap-4">
          <div className="max-w-xl">
            <h2 className="font-heading text-3xl">{dict.home.howTitle}</h2>
            <p className="text-muted-foreground">{dict.home.howLead}</p>
          </div>
          <ol className="grid gap-3 md:grid-cols-4">
            {dict.home.steps.map((step, index) => (
              <li key={step.title} className="rounded-xl border bg-card p-4">
                <span className="text-sm font-semibold text-primary">{String(index + 1).padStart(2, "0")}</span>
                <h3 className="mt-2 font-heading text-lg">{step.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-sidebar p-6 text-sidebar-foreground">
          <div>
            <h2 className="font-heading text-3xl">{dict.home.bandTitle}</h2>
            <p className="mt-1 max-w-prose text-sidebar-foreground/70">{dict.home.bandBody}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild><Link to="/signup">{dict.home.ctaSignUp}</Link></Button>
            <Button variant="outline" className="border-sidebar-foreground/30 bg-transparent text-sidebar-foreground" asChild>
              <Link to="/signin">{dict.home.ctaSignIn}</Link>
            </Button>
          </div>
        </section>
      </main>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t py-6 text-sm text-muted-foreground">
        <BrandLink />
        <p>{dict.home.footerNote} © {year}</p>
        <nav className="flex gap-4" aria-label={dict.nav.primary}>
          <Link to="/signin">{dict.nav.signIn}</Link>
          <Link to="/signup">{dict.nav.signUp}</Link>
        </nav>
      </footer>
    </div>
  );
}
