import { Link, useLocation } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { HomeLogo, LanguageSwitch, ThemeToggle } from "../components/Chrome";
import { useI18n } from "../i18n/I18nProvider";

export default function NotFoundPage() {
  const { dict } = useI18n();
  const { user } = useAuth();
  const inside = useLocation().pathname.startsWith("/app");
  const card = (
    <div className="empty card not-found">
      <h1>{dict.notFound.title}</h1>
      <p>{dict.notFound.body}</p>
      <div className="cta-row">
        <Link className="btn" to="/">
          {dict.notFound.backHome}
        </Link>
        {user && (
          <Link className="btn primary" to="/app">
            {dict.notFound.overview}
          </Link>
        )}
      </div>
    </div>
  );
  if (inside) return card;
  return (
    <div className="plain-page">
      <header className="site-header">
        <HomeLogo />
        <div className="site-tools">
          <LanguageSwitch />
          <ThemeToggle />
        </div>
      </header>
      <main id="main">{card}</main>
    </div>
  );
}
