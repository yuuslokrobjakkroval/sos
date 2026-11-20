import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "upload"
  | "film"
  | "overview"
  | "export"
  | "settings"
  | "sun"
  | "moon"
  | "menu"
  | "close"
  | "search"
  | "user"
  | "logout"
  | "mic"
  | "caption"
  | "gauge"
  | "lock"
  | "languages"
  | "play"
  | "chevron";

interface Props extends SVGProps<SVGSVGElement> {
  name: IconName;
}

const stroke = {
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function Icon({ name, ...props }: Props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true" {...props}>
      {paths[name]}
    </svg>
  );
}

const paths: Record<IconName, ReactNode> = {
  upload: <path {...stroke} d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />,
  film: (
    <>
      <rect {...stroke} x="3" y="5" width="18" height="14" rx="2" />
      <path {...stroke} d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4" />
    </>
  ),
  overview: (
    <>
      <rect {...stroke} x="3" y="3" width="8" height="8" rx="1.5" />
      <rect {...stroke} x="13" y="3" width="8" height="5" rx="1.5" />
      <rect {...stroke} x="13" y="10" width="8" height="11" rx="1.5" />
      <rect {...stroke} x="3" y="13" width="8" height="8" rx="1.5" />
    </>
  ),
  export: (
    <>
      <path {...stroke} d="M12 4v10m0 0 4-4m-4 4-4-4" />
      <path {...stroke} d="M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
    </>
  ),
  settings: (
    <>
      <circle {...stroke} cx="12" cy="12" r="3" />
      <path
        {...stroke}
        d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18"
      />
    </>
  ),
  sun: (
    <>
      <circle {...stroke} cx="12" cy="12" r="4" />
      <path {...stroke} d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.1 5.1l1.6 1.6M17.3 17.3l1.6 1.6M18.9 5.1l-1.6 1.6M6.7 17.3 5.1 18.9" />
    </>
  ),
  moon: <path {...stroke} d="M16 3.2A8.2 8.2 0 1 0 20.8 14 6.4 6.4 0 0 1 16 3.2Z" />,
  menu: <path {...stroke} d="M4 7h16M4 12h16M4 17h16" />,
  close: <path {...stroke} d="m6 6 12 12M18 6 6 18" />,
  search: (
    <>
      <circle {...stroke} cx="11" cy="11" r="6.5" />
      <path {...stroke} d="m16 16 4 4" />
    </>
  ),
  user: (
    <>
      <circle {...stroke} cx="12" cy="8" r="3.2" />
      <path {...stroke} d="M5 19.2c1.4-3 3.8-4.5 7-4.5s5.6 1.5 7 4.5" />
    </>
  ),
  logout: (
    <>
      <path {...stroke} d="M10 7V5.5A1.5 1.5 0 0 1 11.5 4h7A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 10 18.5V17" />
      <path {...stroke} d="M4 12h10m0 0-3-3m3 3-3 3" />
    </>
  ),
  mic: (
    <>
      <rect {...stroke} x="9" y="3" width="6" height="11" rx="3" />
      <path {...stroke} d="M6.5 11a5.5 5.5 0 0 0 11 0M12 16.5V21" />
    </>
  ),
  caption: (
    <>
      <rect {...stroke} x="3" y="5" width="18" height="14" rx="2" />
      <path {...stroke} d="M7 15h4M13 15h4M7 11h10" />
    </>
  ),
  gauge: (
    <>
      <path {...stroke} d="M5 16a7 7 0 1 1 14 0" />
      <path {...stroke} d="m12 13 3.2-3.2" />
    </>
  ),
  lock: (
    <>
      <rect {...stroke} x="5" y="11" width="14" height="9" rx="2" />
      <path {...stroke} d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  languages: (
    <>
      <circle {...stroke} cx="12" cy="12" r="8.5" />
      <path {...stroke} d="M3.5 12h17M12 3.5c2.2 2.4 3.3 5.3 3.3 8.5S14.2 18.1 12 20.5C9.8 18.1 8.7 15.2 8.7 12S9.8 5.9 12 3.5Z" />
    </>
  ),
  play: <path d="M9 7.5v9l8-4.5-8-4.5Z" fill="currentColor" />,
  chevron: <path {...stroke} d="m9 6 6 6-6 6" />,
};
