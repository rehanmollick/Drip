"use client";
import type { CSSProperties, ReactNode } from "react";
import { ICON_NAMES, type IconName } from "@/lib/schemas/visual";

/**
 * The icon set the AI may request (VisualSpec kind="icon"). Every ICON_NAMES
 * entry has an inline SVG on a 24px grid, stroke = currentColor (callers set
 * color: var(--accent)). Rendered ~56–72px on cards.
 */
const P: Record<IconName, ReactNode> = {
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />,
  shield: <path d="M12 2 4 5v6c0 5.2 3.4 9.4 8 11 4.6-1.6 8-5.8 8-11V5l-8-3z" />,
  cpu: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
      <rect x="9.5" y="9.5" width="5" height="5" />
      <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  cloud: <path d="M7 19a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9a4 4 0 0 1 0 10H7z" />,
  lock: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12 21 2M16 7l3 3M13 10l3 3" />
    </>
  ),
  wave: <path d="M2 12c2.5 0 2.5-4 5-4s2.5 4 5 4 2.5-4 5-4 2.5 4 5 4M2 18c2.5 0 2.5-4 5-4s2.5 4 5 4 2.5-4 5-4 2.5 4 5 4" />,
  leaf: (
    <>
      <path d="M20 4c-9 0-15 5-15 12 0 2 .5 3.5 1 4 1-6 5-10 10-12-4 3-7 7-8 12 8 1 13-6 12-16z" />
    </>
  ),
  flask: (
    <>
      <path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9V3" />
      <path d="M7 15h10" />
    </>
  ),
  dna: <path d="M5 3c0 6 14 6 14 12M5 21c0-6 14-6 14-12M5 3c0 6 14 6 14 12M8 6h8M8 18h8M7 12h10" />,
  brain: (
    <>
      <path d="M12 4a3 3 0 0 0-5.7 1.3A3 3 0 0 0 4 10a3 3 0 0 0 1 5.5A3 3 0 0 0 9 20a3 3 0 0 0 3-2V4z" />
      <path d="M12 4a3 3 0 0 1 5.7 1.3A3 3 0 0 1 20 10a3 3 0 0 1-1 5.5A3 3 0 0 1 15 20a3 3 0 0 1-3-2" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  rocket: (
    <>
      <path d="M14 4c3 0 6 3 6 6l-8 8-4-4 6-10z" />
      <path d="M8 14l-4 1 2-4 4-1M10 16l-1 4 4-2 1-4M16 8h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />,
  code: <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />,
  branch: (
    <>
      <circle cx="6" cy="5" r="2.5" />
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <path d="M6 7.5v9M18 10.5c0 4-12 2-12 6" />
    </>
  ),
  server: (
    <>
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
      <path d="M7 7h.01M7 17h.01" />
    </>
  ),
  network: (
    <>
      <circle cx="12" cy="5" r="2.5" />
      <circle cx="5" cy="19" r="2.5" />
      <circle cx="19" cy="19" r="2.5" />
      <path d="M12 7.5v4M12 11.5l-5.5 5.5M12 11.5l5.5 5.5" />
    </>
  ),
  fire: <path d="M12 22c4 0 7-3 7-7 0-3-2-5-3-6 0 2-1 3-2 3 0-4-2-7-5-9 0 3-1 5-3 7s-2 3-2 5c0 4 3 7 8 7zM12 22c-2 0-3-2-3-3.5S10.5 16 12 14c1.5 2 3 3 3 4.5S14 22 12 22z" />,
  drop: <path d="M12 3s7 7.5 7 12a7 7 0 0 1-14 0c0-4.5 7-12 7-12z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M21 13A8.5 8.5 0 0 1 11 3a8.5 8.5 0 1 0 10 10z" />,
  star: <path d="m12 3 2.8 5.9 6.2.8-4.5 4.4 1.1 6.4L12 17.5 6.4 20.5l1.1-6.4L3 9.7l6.2-.8L12 3z" />,
  heart: <path d="M12 21s-7.5-4.6-9.3-9.4C1.4 8 3.5 4.5 7 4.5c2 0 3.5 1 5 3 1.5-2 3-3 5-3 3.5 0 5.6 3.5 4.3 7.1C19.5 16.4 12 21 12 21z" />,
  eye: (
    <>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  book: <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5v-17zM4 19.5A2.5 2.5 0 0 1 6.5 17H20" />,
  pen: <path d="M17 3l4 4-12 12H5v-4L17 3zM14 6l4 4" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
    </>
  ),
  map: <path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3zM9 3v15M15 6v15" />,
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2z" />
    </>
  ),
  anchor: (
    <>
      <circle cx="12" cy="5" r="2.5" />
      <path d="M12 7.5V22M5 12H2a10 10 0 0 0 20 0h-3" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  puzzle: <path d="M10 3a2 2 0 0 1 2 2v1h3a1 1 0 0 1 1 1v3h1a2 2 0 1 1 0 4h-1v3a1 1 0 0 1-1 1h-3v1a2 2 0 1 1-4 0v-1H5a1 1 0 0 1-1-1v-3h1a2 2 0 1 0 0-4H4V7a1 1 0 0 1 1-1h3V5a2 2 0 0 1 2-2z" />,
  layers: <path d="m12 3 9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5" />,
  box: <path d="m12 2 9 5v10l-9 5-9-5V7l9-5zM3 7l9 5 9-5M12 12v10" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  tag: (
    <>
      <path d="M3 3h8l10 10-8 8L3 11V3z" />
      <path d="M7.5 7.5h.01" />
    </>
  ),
  flag: <path d="M5 22V3h13l-2.5 4.5L18 12H5" />,
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" />
    </>
  ),
  trophy: (
    <>
      <path d="M7 3h10v6a5 5 0 0 1-10 0V3zM7 5H3v2a4 4 0 0 0 4 4M17 5h4v2a4 4 0 0 1-4 4M12 14v4M8 21h8M9 18h6" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3 2 21h20L12 3z" />
      <path d="M12 10v5M12 18h.01" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" />
    </>
  ),
  check: <path d="m4 12.5 5 5L20 6.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  arrow: <path d="M4 12h16M13 5l7 7-7 7" />,
  loop: <path d="M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2M18 3v3h-3M6 21v-3h3" />,
  scale: <path d="M12 3v18M8 21h8M3 8h18M6 8l-3 7a3 3 0 0 0 6 0L6 8zM18 8l-3 7a3 3 0 0 0 6 0l-3-7z" />,
  coin: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M14.5 9.5A2.5 2.5 0 0 0 12 8c-1.5 0-2.5.8-2.5 2s1 1.6 2.5 2 2.5.8 2.5 2-1 2-2.5 2a2.5 2.5 0 0 1-2.5-1.5M12 6v2M12 16v2" />
    </>
  ),
  atom: (
    <>
      <circle cx="12" cy="12" r="1.5" />
      <ellipse cx="12" cy="12" rx="9" ry="3.5" />
      <ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(120 12 12)" />
    </>
  ),
  wrench: <path d="M14.5 6.5a4 4 0 0 0 5 5L9.5 21.5a2.1 2.1 0 0 1-3-3l10-10zM14.5 6.5A4 4 0 0 1 20 3l-3 3 1 1 3-3a4 4 0 0 1-.5 3.5" />,
  bug: (
    <>
      <path d="M8 9a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0V9z" />
      <path d="M8 12H3M21 12h-5M8 8 5 5M16 8l3-3M8 16l-3 3M16 16l3 3M9 6a3 3 0 0 1 6 0" />
    </>
  ),
};

export const ICON_SET: ReadonlySet<string> = new Set(ICON_NAMES);

export function Icon({
  name,
  size = 64,
  strokeWidth = 1.5,
  color = "var(--accent)",
  className,
  style,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const body = P[name] ?? P.question;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      style={{ color, display: "block", ...style }}
    >
      {body}
    </svg>
  );
}
