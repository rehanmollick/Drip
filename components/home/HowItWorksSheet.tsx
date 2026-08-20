"use client";
import { BottomSheet } from "./BottomSheet";

/**
 * "how this works" — the machine's capabilities said out loud, in feed voice.
 * Every line is a flex about the reader, not a spec. Opened from the quiet row
 * on home and from the tile menu sheet.
 */
const GROUPS: readonly { heading: string; lines: readonly string[] }[] = [
  {
    heading: "its eyes",
    lines: [
      "how you answer quietly sets how hard it runs — lucky taps barely move it, real ones do",
      "flick through fast and it says less — fewer words, bigger claims",
      "sit a while on one card and that idea gets brought back up a few cards later",
      "scroll back up and it notices — a fresh retake lands just ahead, on a comparison it hasn't used yet",
      "miss a few and the next stretch re-angles the wobbly bit before betting on it again",
    ],
  },
  {
    heading: "its memory",
    lines: [
      "it carries the plot the whole way — card 40 still knows what card 1 promised",
      "ideas you met come back later as fresh bets — never announced, never re-explained",
      "underlined words open on a tap, and you're never handed the same one twice",
      "every subject gets its own look and its own narrator — palette, type, and one world all the comparisons come from",
    ],
  },
  {
    heading: "its manners",
    lines: [
      "at the end of every stretch it stops and asks where to go — it never just piles on",
      "ask anything mid-scroll — quick stuff answered on the spot, big stuff becomes a short side thread",
      "say an idea back in your own words and the reply speaks to what you wrote — never a verdict stamp",
      "tap simpler or deeper and everything unread is rewritten to match",
      "chill mode drops every ask — nothing to answer, nothing measured, just the show",
      "say wrap it up and you get a real ending — the thread in a few beats, one door left open",
    ],
  },
  {
    heading: "the safety rails",
    lines: [
      "the next stretch is written while you read this one — the card under your thumb never changes",
      "never two walls of text in a row — every stretch carries something to look at",
      "progress reads like a flex, never a score — hold the thin rail on the right edge for the map",
      "lose signal and what's loaded keeps scrolling — your taps land the moment you're back",
      "there's a daily ceiling on the machine behind this — hit it and the feed says so, resets at midnight",
    ],
  },
];

export function HowItWorksSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} label="how this works" tall>
      <div className="flex flex-col gap-5 pb-4">
        <p className="font-display text-xl text-ink">how this works</p>
        {GROUPS.map((g) => (
          <section key={g.heading} className="flex flex-col gap-2">
            <h3 className="font-mono text-[11px] tracking-wide" style={{ color: "var(--accent)" }}>
              {g.heading}
            </h3>
            <ul className="flex flex-col gap-2">
              {g.lines.map((line) => (
                <li key={line} className="flex gap-2.5 font-body text-sm leading-snug text-ink">
                  <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--accent)" }} />
                  <span className="text-pretty">{line}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </BottomSheet>
  );
}
