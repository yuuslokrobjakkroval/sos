import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { useEngine } from "../engine/EngineProvider";
import { useI18n } from "../i18n/I18nProvider";
import { fill } from "../i18n/text";
import {
  AppLogo,
  CommandText,
  initials,
  LanguageSwitch,
  ThemeToggle,
} from "./Chrome";
import { Icon, type IconName } from "./Icons";

const COLLAPSE_KEY = "automate.nav.collapsed";
const SETUP_CMD = "scripts\\setup-tools.ps1";
const SERVER_CMD = "npm run server";

interface ShellContext {
  setCrumb: (label: string | null) => void;
}

export type { ShellContext };

export default function Shell() {
  const { dict } = useI18n();
  const { user, signOut } = useAuth();
  const { videos, health, offline } = useEngine();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [crumb, setCrumb] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchId = useId();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeHit, setActiveHit] = useState(0);

  useEffect(() => {
    setNavOpen(false);
    setMenuOpen(false);
    setSearchOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || !videos) return [];
    return videos.filter((video) => video.filename.toLowerCase().includes(needle)).slice(0, 6);
  }, [query, videos]);

  useEffect(() => setActiveHit(0), [query]);

  function goToVideo(id: string) {
    setQuery("");
    setSearchOpen(false);
    navigate(`/app/videos/${id}`);
  }

  function toggleCollapsed() {
    setCollapsed((current) => {
      localStorage.setItem(COLLAPSE_KEY, current ? "0" : "1");
      return !current;
    });
  }

  const section = crumbKey(location.pathname);
  const sectionLabel = dict.nav[section];
  const sectionTo =
    section === "library"
      ? "/app/videos"
      : section === "upload"
        ? "/app/upload"
        : section === "exports"
          ? "/app/exports"
          : section === "settings"
            ? "/app/settings"
            : "/app";

  const missing = health
    ? [
        !health.ffmpeg ? dict.engine.toolFfmpeg : null,
        !health.whisper ? dict.engine.toolWhisper : null,
        !health.model ? dict.engine.toolModel : null,
      ].filter((item): item is string => Boolean(item))
    : [];

  const items: { to: string; end?: boolean; icon: IconName; label: string }[] = [
    { to: "/app", end: true, icon: "overview", label: dict.nav.overview },
    { to: "/app/videos", icon: "film", label: dict.nav.library },
    { to: "/app/upload", icon: "upload", label: dict.nav.upload },
    { to: "/app/exports", icon: "export", label: dict.nav.exports },
    { to: "/app/settings", icon: "settings", label: dict.nav.settings },
  ];

  return (
    <div className={`shell ${collapsed ? "collapsed" : ""} ${navOpen ? "nav-open" : ""}`}>
      <a className="skip-link" href="#main">
        {dict.skip}
      </a>
      {navOpen && (
        <button type="button" className="backdrop" aria-label={dict.common.closeMenu} onClick={() => setNavOpen(false)} />
      )}
      <aside className="sidebar" aria-label={dict.nav.primary}>
        <AppLogo compact={collapsed} />
        <nav className="side-nav">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? "active" : "")}>
              <Icon name={item.icon} />
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          {health && <EnginePill />}
          <button type="button" className="nav-collapse" onClick={toggleCollapsed} aria-pressed={collapsed}>
            <Icon name="chevron" />
            <span className="nav-label">{collapsed ? dict.nav.expand : dict.nav.collapse}</span>
          </button>
        </div>
      </aside>
      <div className="shell-main">
        <header className="navbar">
          <button type="button" className="icon-btn menu-btn" aria-label={dict.common.openMenu} onClick={() => setNavOpen(true)}>
            <Icon name="menu" />
          </button>
          <nav aria-label={dict.nav.breadcrumb}>
            <ol className="crumbs">
              <li>
                {section === "overview" && !crumb ? (
                  <span aria-current="page">{dict.nav.overview}</span>
                ) : (
                  <Link to="/app">{dict.nav.overview}</Link>
                )}
              </li>
              {section !== "overview" && (
                <li>
                  {crumb ? <Link to={sectionTo}>{sectionLabel}</Link> : <span aria-current="page">{sectionLabel}</span>}
                </li>
              )}
              {crumb && (
                <li>
                  <span aria-current="page" className="truncate">
                    {crumb}
                  </span>
                </li>
              )}
            </ol>
          </nav>
          <div className="search">
            <label className="sr-only" htmlFor={searchId}>
              {dict.common.search}
            </label>
            <Icon name="search" />
            <input
              id={searchId}
              role="combobox"
              aria-expanded={searchOpen && query.trim().length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              placeholder={dict.common.searchPlaceholder}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setSearchOpen(false)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveHit((index) => Math.min(index + 1, Math.max(matches.length - 1, 0)));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveHit((index) => Math.max(index - 1, 0));
                } else if (event.key === "Enter" && matches[activeHit]) {
                  event.preventDefault();
                  goToVideo(matches[activeHit].id);
                } else if (event.key === "Escape") {
                  setSearchOpen(false);
                }
              }}
            />
            {searchOpen && query.trim() && (
              <ul id={listId} role="listbox" className="search-pop">
                {matches.length === 0 ? (
                  <li className="muted">{dict.common.noResults}</li>
                ) : (
                  matches.map((video, index) => (
                    <li key={video.id} role="option" aria-selected={index === activeHit}>
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => goToVideo(video.id)}
                      >
                        {video.filename}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
          <LanguageSwitch />
          <ThemeToggle />
          <div className="user-menu" ref={menuRef}>
            <button
              type="button"
              className="avatar"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={user?.name ?? dict.nav.profile}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {initials(user?.name ?? "")}
            </button>
            {menuOpen && (
              <div role="menu" className="menu">
                <p className="menu-id">
                  <strong>{user?.name}</strong>
                  <span>{user?.email}</span>
                </p>
                <Link role="menuitem" to="/app/settings#account" onClick={() => setMenuOpen(false)}>
                  <Icon name="user" /> {dict.nav.profile}
                </Link>
                <Link role="menuitem" to="/app/settings" onClick={() => setMenuOpen(false)}>
                  <Icon name="settings" /> {dict.nav.settings}
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void signOut().then(() => navigate("/"));
                  }}
                >
                  <Icon name="logout" /> {dict.nav.signOut}
                </button>
              </div>
            )}
          </div>
        </header>
        <div className="shell-content" id="main">
          {offline && (
            <div className="banner error" role="alert">
              <CommandText template={dict.engine.offline} command={SERVER_CMD} />
            </div>
          )}
          {health && !health.ok && (
            <div className="banner warn" role="status">
              <p>{fill(dict.engine.missing, { tools: missing.join(dict.engine.listSep) })}</p>
              <p>
                <CommandText template={dict.engine.setupHint} command={SETUP_CMD} />
              </p>
            </div>
          )}
          <Outlet context={{ setCrumb } satisfies ShellContext} />
        </div>
      </div>
    </div>
  );
}

function crumbKey(pathname: string): "overview" | "library" | "upload" | "exports" | "settings" {
  if (pathname.startsWith("/app/videos")) return "library";
  if (pathname.startsWith("/app/upload")) return "upload";
  if (pathname.startsWith("/app/exports")) return "exports";
  if (pathname.startsWith("/app/settings")) return "settings";
  return "overview";
}

function EnginePill() {
  const { dict } = useI18n();
  const { health } = useEngine();
  if (!health) return null;
  const tip = health.vision
    ? fill(dict.engine.screenOnTip, { model: health.vision_model ?? "" })
    : dict.engine.screenOffTip;
  const label = health.ok
    ? `${fill(dict.engine.ready, { model: health.model_name ?? "whisper" })}${
        health.vision ? ` · ${dict.engine.screenOn}` : ""
      }`
    : dict.engine.setup;
  return (
    <p className={`engine-pill ${health.ok ? "ok" : "warn"}`} title={tip}>
      <span className="dot" aria-hidden="true" />
      <span className="nav-label">{label}</span>
      <span className="sr-only">{tip}</span>
    </p>
  );
}
