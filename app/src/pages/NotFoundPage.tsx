import { Link, useLocation } from "react-router";
import { useAuth } from "@/auth/AuthProvider";
import { BrandLink, LanguageSelect, ThemeToggle } from "@/components/preferences";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/i18n/I18nProvider";

export default function NotFoundPage() {
  const { dict } = useI18n();
  const { user } = useAuth();
  const inside = useLocation().pathname.startsWith("/app");
  const card = (
    <Card className="mx-auto w-full max-w-lg">
      <CardContent className="flex flex-col items-start gap-3 py-10">
        <h1 className="font-heading text-3xl">{dict.notFound.title}</h1>
        <p className="text-muted-foreground">{dict.notFound.body}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild><Link to="/">{dict.notFound.backHome}</Link></Button>
          {user && <Button asChild><Link to="/app">{dict.notFound.overview}</Link></Button>}
        </div>
      </CardContent>
    </Card>
  );
  if (inside) return card;
  return (
    <div className="min-h-svh">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4">
        <BrandLink />
        <span className="flex items-center gap-2">
          <LanguageSelect />
          <ThemeToggle />
        </span>
      </header>
      <main id="main" className="px-4 py-10">{card}</main>
    </div>
  );
}
