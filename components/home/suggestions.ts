/**
 * Suggested starts for the new-session sheet + the home empty state. Each set
 * teaches the three input shapes by example: a curiosity question, a lone URL
 * (which also demos the unfurl row), and an "explain X like i'm smart" ask.
 * Tapping a chip fills the field — it never submits.
 */
export type Suggestion = {
  /** what the chip says (short enough for a pill) */
  label: string;
  /** what lands in the textarea on tap */
  fill: string;
};

export const SUGGESTION_SETS: readonly (readonly Suggestion[])[] = [
  [
    { label: "why is the sky dark at night?", fill: "why is the sky dark at night if there are infinite stars?" },
    { label: "or paste a link →", fill: "https://en.wikipedia.org/wiki/Antikythera_mechanism" },
    { label: "explain gps like i'm smart but new", fill: "explain how gps knows where i am, like i'm smart but new to it" },
  ],
  [
    { label: "why can't we just print more money?", fill: "why can't we just print more money?" },
    { label: "or paste a link →", fill: "https://en.wikipedia.org/wiki/Fermi_paradox" },
    { label: "explain transformers like i'm smart but new", fill: "explain how transformers actually work, like i'm smart but new to it" },
  ],
  [
    { label: "how do noise-cancelling headphones work?", fill: "how do noise-cancelling headphones actually work?" },
    { label: "or paste a link →", fill: "https://en.wikipedia.org/wiki/Voyager_Golden_Record" },
    { label: "explain kubernetes like i've never touched it", fill: "explain kubernetes like i'm a backend dev who's never touched it" },
  ],
] as const;

/** stable pick for any counter (day index, open count) — never out of range */
export function suggestionsAt(n: number): readonly Suggestion[] {
  const i = ((n % SUGGESTION_SETS.length) + SUGGESTION_SETS.length) % SUGGESTION_SETS.length;
  return SUGGESTION_SETS[i];
}

/** day-granular seed so the shelf doesn't show the same three examples forever */
export function daySeed(now = Date.now()): number {
  return Math.floor(now / 86_400_000);
}
