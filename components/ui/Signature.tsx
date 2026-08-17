"use client";
import { motion, type Variants } from "framer-motion";
import { useMemo, type CSSProperties, type ReactNode } from "react";
import type { Theme } from "@/lib/schemas/theme";
import { useTheme } from "@/components/theme/ThemeRoot";
import { hashString, hexAddress, seededRandom } from "@/components/cards/helpers";
import { Eyebrow } from "./Eyebrow";

export type SignatureKind = Theme["signatureKind"];

/**
 * The theme's ONE signature device (spec §4), applied on hook + checkpoint
 * cards. Two mount points: the eyebrow (hex-addresses / stamp / ticker) and
 * the headline (water-lines / cursor-blink / ruled-notes / waveform /
 * constellation / brackets / underline-sweep). Inner motion elements use
 * variants {hidden, show} so they ride the card's entry stagger and never
 * replay. Keep every device subtle.
 */

export function useSignatureKind(): SignatureKind {
  return useTheme().theme.signatureKind;
}

const isHexLike = (s: string) => /^0x[0-9a-f]+/i.test(s.trim());

/** Eyebrow with the signature treatment. `seed` (card id) drives hex addresses. */
export function SignatureEyebrow({ text, seed, style }: { text?: string; seed: string; style?: CSSProperties }) {
  const { reduced } = useTheme();
  const kind = useSignatureKind();

  if (kind === "hex-addresses") {
    const label = !text ? hexAddress(seed) : isHexLike(text) ? text : `${hexAddress(seed)} · ${text}`;
    return <Eyebrow style={style}>{label}</Eyebrow>;
  }
  if (kind === "stamp") {
    return (
      <motion.span
        variants={{ hidden: { opacity: 0, rotate: reduced ? -4 : -14, scale: reduced ? 1 : 1.25 }, show: { opacity: 1, rotate: -4, scale: 1, transition: reduced ? { duration: 0.15 } : { type: "spring", stiffness: 520, damping: 22 } } }}
        className="font-mono uppercase"
        style={{
          display: "inline-block",
          fontSize: 11,
          letterSpacing: "0.16em",
          lineHeight: 1,
          padding: "6px 9px",
          border: "1.5px solid var(--accent)",
          borderRadius: 4,
          color: "var(--accent)",
          transformOrigin: "center",
          boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--accent) 35%, transparent)",
          maskImage: "radial-gradient(circle at 30% 40%, black 60%, rgba(0,0,0,0.6) 100%)",
          WebkitMaskImage: "radial-gradient(circle at 30% 40%, black 60%, rgba(0,0,0,0.6) 100%)",
          ...style,
        }}
      >
        {text ?? "drip"}
      </motion.span>
    );
  }
  if (kind === "ticker") {
    const t = (text ?? "drip").toUpperCase();
    const run = Array.from({ length: 8 }, () => t).join("   ✦   ") + "   ✦   ";
    return (
      <span
        aria-label={text}
        style={{
          display: "block",
          width: "100%",
          overflow: "hidden",
          borderTop: "1px solid var(--accent)",
          borderBottom: "1px solid var(--accent)",
          padding: "3px 0",
          maskImage: "linear-gradient(90deg, transparent, black 8%, black 92%, transparent)",
          WebkitMaskImage: "linear-gradient(90deg, transparent, black 8%, black 92%, transparent)",
          ...style,
        }}
      >
        <motion.span
          aria-hidden
          className="font-mono"
          animate={reduced ? undefined : { x: ["0%", "-50%"] }}
          transition={{ repeat: Infinity, ease: "linear", duration: 18 }}
          style={{ display: "inline-block", whiteSpace: "nowrap", fontSize: 10.5, letterSpacing: "0.18em", color: "var(--accent)", lineHeight: 1.2, willChange: "transform" }}
        >
          <span>{run}</span>
          <span>{run}</span>
        </motion.span>
      </span>
    );
  }
  if (!text) return null;
  return <Eyebrow style={style}>{text}</Eyebrow>;
}

/** Headline wrapper with the signature treatment. Renders `as` (h1/h2) with `children` inside. */
export function SignatureHeadline({
  children,
  as: Tag = "h1",
  className = "",
  style,
  seed,
}: {
  children: ReactNode;
  as?: "h1" | "h2" | "p";
  className?: string;
  style?: CSSProperties;
  seed: string;
}) {
  const { reduced, spring } = useTheme();
  const kind = useSignatureKind();
  const grow: Variants = {
    hidden: { scaleX: 0, opacity: 0 },
    show: { scaleX: 1, opacity: 1, transition: reduced ? { duration: 0.15 } : { ...spring, delay: 0.12 } },
  };

  const constellation = useMemo(() => {
    if (kind !== "constellation") return null;
    const rnd = seededRandom(hashString(seed));
    // stratified in x so the constellation spans the whole headline, jittered in y
    const pts = Array.from({ length: 7 }, (_, i) => ({ x: 3 + ((i + rnd() * 0.9) / 7) * 94, y: 6 + rnd() * 88 }));
    const lines: [number, number][] = [];
    for (let i = 0; i < pts.length - 1; i++) lines.push([i, i + 1]);
    lines.push([0, 3], [2, 5]);
    return { pts, lines };
  }, [kind, seed]);

  const wrapStyle: CSSProperties = { position: "relative", ...style };

  if (kind === "cursor-blink") {
    return (
      <Tag className={`${className} cursor-blink`} style={wrapStyle}>
        {children}
      </Tag>
    );
  }

  if (kind === "brackets") {
    return (
      <Tag className={className} style={wrapStyle}>
        <span aria-hidden style={{ color: "var(--accent)", fontWeight: 800, marginRight: "0.12em" }}>[</span>
        {children}
        <span aria-hidden style={{ color: "var(--accent)", fontWeight: 800, marginLeft: "0.12em" }}>]</span>
      </Tag>
    );
  }

  if (kind === "ruled-notes") {
    return (
      <Tag
        className={className}
        style={{
          ...wrapStyle,
          paddingBlock: "0.15em",
          backgroundImage: "repeating-linear-gradient(to bottom, transparent 0, transparent calc(0.98em - 1px), var(--line) calc(0.98em - 1px), var(--line) 0.98em)",
          backgroundSize: "100% 0.98em",
          backgroundPosition: "0 0.15em",
        }}
      >
        {children}
      </Tag>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      {kind === "constellation" && constellation && (
        <motion.svg
          aria-hidden
          variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: reduced ? 0.15 : 0.9, delay: reduced ? 0 : 0.2 } } }}
          style={{ position: "absolute", inset: "-10% -4%", width: "108%", height: "120%", pointerEvents: "none", overflow: "visible", zIndex: 0 }}
        >
          {constellation.lines.map(([a, b], i) => (
            <line key={i} x1={`${constellation.pts[a].x}%`} y1={`${constellation.pts[a].y}%`} x2={`${constellation.pts[b].x}%`} y2={`${constellation.pts[b].y}%`} stroke="var(--accent)" strokeWidth={0.75} opacity={0.4} />
          ))}
          {constellation.pts.map((p, i) => (
            <circle key={i} cx={`${p.x}%`} cy={`${p.y}%`} r={i % 3 === 0 ? 2.6 : 1.7} fill="var(--accent)" opacity={0.75} />
          ))}
        </motion.svg>
      )}
      <Tag className={className} style={{ ...wrapStyle, zIndex: 1 }}>
        {children}
      </Tag>
      {kind === "underline-sweep" && (
        <motion.span
          aria-hidden
          variants={grow}
          style={{ display: "block", height: 3, width: "38%", maxWidth: 140, marginTop: 10, background: "var(--accent)", borderRadius: 2, transformOrigin: "left center" }}
        />
      )}
      {kind === "water-lines" && (
        <motion.svg
          aria-hidden
          viewBox="0 0 200 18"
          preserveAspectRatio="none"
          variants={{ hidden: {}, show: { transition: { staggerChildren: reduced ? 0 : 0.09, delayChildren: 0.1 } } }}
          style={{ display: "block", width: "min(60%, 220px)", height: 18, marginTop: 8, overflow: "visible" }}
        >
          {[14, 9, 4].map((y, i) => (
            <motion.path
              key={y}
              d={`M0 ${y} q 12 -${3 + i} 25 0 t 25 0 t 25 0 t 25 0 t 25 0 t 25 0 t 25 0 t 25 0`}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1.4}
              strokeLinecap="round"
              opacity={0.9 - i * 0.28}
              variants={{
                hidden: { pathLength: 0, y: reduced ? 0 : 6, opacity: 0 },
                show: { pathLength: 1, y: 0, opacity: 0.9 - i * 0.28, transition: reduced ? { duration: 0.15 } : { duration: 0.7, ease: "easeOut" } },
              }}
            />
          ))}
        </motion.svg>
      )}
      {kind === "waveform" && <Waveform seed={seed} reduced={reduced} />}
    </div>
  );
}

function Waveform({ seed, reduced }: { seed: string; reduced: boolean }) {
  const bars = useMemo(() => {
    const rnd = seededRandom(hashString(seed) ^ 0x9e37);
    return Array.from({ length: 22 }, (_, i) => {
      const env = Math.sin((i / 21) * Math.PI);
      return 3 + Math.round((0.35 + rnd() * 0.65) * env * 15);
    });
  }, [seed]);
  return (
    <motion.span
      aria-hidden
      variants={{ hidden: {}, show: { transition: { staggerChildren: reduced ? 0 : 0.018, delayChildren: 0.08 } } }}
      style={{ display: "flex", alignItems: "center", gap: 3, height: 20, marginTop: 10 }}
    >
      {bars.map((h, i) => (
        <motion.span
          key={i}
          variants={{ hidden: { scaleY: reduced ? 1 : 0.15, opacity: 0 }, show: { scaleY: 1, opacity: 1, transition: reduced ? { duration: 0.15 } : { type: "spring", stiffness: 420, damping: 18 } } }}
          style={{ width: 2.5, height: h, borderRadius: 2, background: "var(--accent)", transformOrigin: "center", opacity: 0.85 }}
        />
      ))}
    </motion.span>
  );
}
