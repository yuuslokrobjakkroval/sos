import { useState } from "react";
import { Link } from "react-router";
import { HomeLogo, LanguageSwitch, ThemeToggle } from "../components/Chrome";
import { Icon, type IconName } from "../components/Icons";
import { useI18n } from "../i18n/I18nProvider";

const FEATURE_ICONS: IconName[] = ["mic", "caption", "gauge", "export", "languages", "lock"];

export default function HomePage() {
  const { dict } = useI18n();
  const [open, setOpen] = useState(false);
  const year = new Date().getFullYear();

  return (
    <div className="site">
      <a className="skip-link" href="#main">
        {dict.skip}
      </a>
      <header className="site-header">
        <HomeLogo />
        <div className="site-end">
          <nav className={`site-nav ${open ? "open" : ""}`} aria-label={dict.nav.primary}>
            <a href="#features" onClick={() => setOpen(false)}>
              {dict.nav.features}
            </a>
            <a href="#how" onClick={() => setOpen(false)}>
              {dict.nav.how}
            </a>
            <Link className="btn" to="/signin" onClick={() => setOpen(false)}>
              {dict.nav.signIn}
            </Link>
            <Link className="btn primary" to="/signup" onClick={() => setOpen(false)}>
              {dict.nav.signUp}
            </Link>
          </nav>
          <div className="site-tools">
            <LanguageSwitch />
            <ThemeToggle />
            <button
              type="button"
              className="icon-btn menu-btn"
              aria-expanded={open}
              aria-label={open ? dict.common.closeMenu : dict.common.openMenu}
              onClick={() => setOpen((value) => !value)}
            >
              <Icon name={open ? "close" : "menu"} />
            </button>
          </div>
        </div>
      </header>
      <main id="main">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">{dict.home.eyebrow}</p>
            <h1>{dict.home.title}</h1>
            <p className="lead">{dict.home.lead}</p>
            <div className="cta-row">
              <Link className="btn primary lg" to="/signup">
                {dict.home.ctaSignUp}
              </Link>
              <Link className="btn lg" to="/signin">
                {dict.home.ctaSignIn}
              </Link>
            </div>
          </div>
          <div className="hero-stage" aria-hidden="true">
            <div className="stage-top">
              <span className="stage-play">
                <Icon name="play" width={16} height={16} />
              </span>
              <span>{dict.home.stageBadge}</span>
              <span className="chip ok">{dict.pace.normal}</span>
            </div>
            <ul>
              {dict.home.sample.map((line, index) => (
                <li key={line.time} className={index === 1 ? "active" : ""}>
                  <span>{line.time}</span>
                  <span>{line.text}</span>
                  <span>{line.wpm}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="features" className="section">
          <div className="section-head">
            <h2>{dict.home.featuresTitle}</h2>
            <p>{dict.home.featuresLead}</p>
          </div>
          <div className="feature-grid">
            {dict.home.features.map((feature, index) => (
              <article key={feature.title} className="feature-card">
                <span className="feature-icon">
                  <Icon name={FEATURE_ICONS[index] ?? "film"} />
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="how" className="section">
          <div className="section-head">
            <h2>{dict.home.howTitle}</h2>
            <p>{dict.home.howLead}</p>
          </div>
          <ol className="how-steps">
            {dict.home.steps.map((step, index) => (
              <li key={step.title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="band">
          <div>
            <h2>{dict.home.bandTitle}</h2>
            <p>{dict.home.bandBody}</p>
          </div>
          <div className="cta-row">
            <Link className="btn primary lg" to="/signup">
              {dict.home.ctaSignUp}
            </Link>
            <Link className="btn lg light" to="/signin">
              {dict.home.ctaSignIn}
            </Link>
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <HomeLogo />
        <p>
          {dict.home.footerNote} © {year}
        </p>
        <nav aria-label={dict.nav.primary}>
          <Link to="/signin">{dict.nav.signIn}</Link>
          <Link to="/signup">{dict.nav.signUp}</Link>
        </nav>
      </footer>
    </div>
  );
}
