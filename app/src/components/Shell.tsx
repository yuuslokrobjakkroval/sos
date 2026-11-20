import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useOutletContext } from "react-router";
import {
  DashboardSquare01Icon,
  Download01Icon,
  Logout01Icon,
  Settings01Icon,
  Upload01Icon,
  UserIcon,
  Video01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { useAuth } from "@/auth/AuthProvider";
import { AppIcon } from "@/components/icon";
import { BrandLink, LanguageSelect, ThemeToggle } from "@/components/preferences";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useEngine } from "@/engine/EngineProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { fill } from "@/i18n/text";

const SETUP_CMD = "scripts\\setup-tools.ps1";
const SERVER_CMD = "npm run server";

export interface ShellContext {
  setCrumb: (label: string | null) => void;
}

export default function Shell() {
  const { dict } = useI18n();
  const { user, signOut } = useAuth();
  const { videos, health, offline } = useEngine();
  const navigate = useNavigate();
  const location = useLocation();
  const [crumb, setCrumb] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setQuery("");
  }, [location.pathname]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || !videos) return [];
    return videos.filter((video) => video.filename.toLowerCase().includes(needle)).slice(0, 6);
  }, [query, videos]);

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

  const items: { to: string; end?: boolean; icon: IconSvgElement; label: string }[] = [
    { to: "/app", end: true, icon: DashboardSquare01Icon, label: dict.nav.overview },
    { to: "/app/videos", icon: Video01Icon, label: dict.nav.library },
    { to: "/app/upload", icon: Upload01Icon, label: dict.nav.upload },
    { to: "/app/exports", icon: Download01Icon, label: dict.nav.exports },
    { to: "/app/settings", icon: Settings01Icon, label: dict.nav.settings },
  ];

  const tip = health
    ? health.vision
      ? fill(dict.engine.screenOnTip, { model: health.vision_model ?? "" })
      : dict.engine.screenOffTip
    : "";
  const engineLabel = health
    ? health.ok
      ? `${fill(dict.engine.ready, { model: health.model_name ?? "whisper" })}${health.vision ? ` · ${dict.engine.screenOn}` : ""}`
      : dict.engine.setup
    : "";

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <BrandLink to="/app" />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              {items.map((item) => {
                const active = item.end
                  ? location.pathname === item.to
                  : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                      <Link to={item.to}>
                        <AppIcon icon={item.icon} />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          {health && (
            <p className="px-2 text-xs leading-snug text-sidebar-foreground/70" title={tip}>
              <span className={`mr-2 inline-block size-2 rounded-full ${health.ok ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden />
              {engineLabel}
              <span className="sr-only">{tip}</span>
            </p>
          )}
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">
          {dict.skip}
        </a>
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b bg-background/90 px-3 py-2 backdrop-blur">
          <SidebarTrigger />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                {section === "overview" && !crumb ? (
                  <BreadcrumbPage>{dict.nav.overview}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to="/app">{dict.nav.overview}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {section !== "overview" && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    {crumb ? (
                      <BreadcrumbLink asChild>
                        <Link to={sectionTo}>{sectionLabel}</Link>
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage>{sectionLabel}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                </>
              )}
              {crumb && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage className="max-w-48 truncate">{crumb}</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="relative min-w-40 flex-1">
            <Command shouldFilter={false} className="overflow-visible bg-transparent">
              <CommandInput
                aria-label={dict.common.search}
                placeholder={dict.common.searchPlaceholder}
                value={query}
                onValueChange={setQuery}
              />
              {query.trim() && (
                <CommandList className="absolute top-full z-30 mt-1 max-h-64 w-full rounded-lg border bg-popover shadow-md">
                  {matches.length === 0 ? (
                    <CommandEmpty>{dict.common.noResults}</CommandEmpty>
                  ) : (
                    <CommandGroup>
                      {matches.map((video) => (
                        <CommandItem
                          key={video.id}
                          value={video.filename}
                          onSelect={() => {
                            setQuery("");
                            navigate(`/app/videos/${video.id}`);
                          }}
                        >
                          {video.filename}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </CommandList>
              )}
            </Command>
          </div>
          <LanguageSelect />
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="rounded-full" aria-label={user?.name ?? dict.nav.profile}>
                <Avatar>
                  <AvatarFallback>{initials(user?.name ?? "")}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                <span>{user?.name}</span>
                <span className="text-xs font-normal text-muted-foreground">{user?.email}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/app/settings#account">
                  <AppIcon icon={UserIcon} /> {dict.nav.profile}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/app/settings">
                  <AppIcon icon={Settings01Icon} /> {dict.nav.settings}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void signOut().then(() => navigate("/"));
                }}
              >
                <AppIcon icon={Logout01Icon} /> {dict.nav.signOut}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <div id="main" className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 pb-16 md:p-6">
          {offline && (
            <Alert variant="destructive">
              <AlertDescription>
                <CommandText template={dict.engine.offline} command={SERVER_CMD} />
              </AlertDescription>
            </Alert>
          )}
          {health && !health.ok && (
            <Alert>
              <AlertDescription>
                <p>{fill(dict.engine.missing, { tools: missing.join(dict.engine.listSep) })}</p>
                <p>
                  <CommandText template={dict.engine.setupHint} command={SETUP_CMD} />
                </p>
              </AlertDescription>
            </Alert>
          )}
          <Outlet context={{ setCrumb } satisfies ShellContext} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function crumbKey(pathname: string): "overview" | "library" | "upload" | "exports" | "settings" {
  if (pathname.startsWith("/app/videos")) return "library";
  if (pathname.startsWith("/app/upload")) return "upload";
  if (pathname.startsWith("/app/exports")) return "exports";
  if (pathname.startsWith("/app/settings")) return "settings";
  return "overview";
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const words = trimmed.split(/\s+/);
  if (words.length >= 2) return `${[...words[0]][0] ?? ""}${[...words[1]][0] ?? ""}`.toUpperCase();
  return ([...trimmed][0] ?? "?").toUpperCase();
}

function CommandText({ template, command }: { template: string; command: string }) {
  const [before, after = ""] = template.split("{command}");
  return (
    <>
      {before}
      <code className="rounded bg-muted px-1 py-0.5 text-xs">{command}</code>
      {after}
    </>
  );
}

export function useShell() {
  return useOutletContext<ShellContext>();
}
