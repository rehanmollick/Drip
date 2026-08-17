import { createCssVariablesTheme, createHighlighter, type BundledLanguage, type Highlighter } from "shiki";
import type { CodeCard } from "@/lib/schemas/cards";

type HighlightedLine = { t: string; c?: string }[];

/**
 * Server-side shiki highlighting for `code` cards. Runs AFTER validation and
 * BEFORE persistence; the AI never touches `highlighted`.
 *
 * Theme: css-variables — every token color is `var(--shiki-token-…)`, which
 * lib/theme/cssVars.ts derives from the session's ink/accent. One highlighter,
 * infinite skins. Never throws: on any failure the card is returned as-is
 * (the renderer falls back to plain mono text).
 */

export const HIGHLIGHT_LANGS = [
  "ts", "tsx", "js", "jsx", "json", "bash", "sh", "python", "go", "rust", "sql", "html", "css", "yaml",
  "java", "c", "cpp", "csharp", "ruby", "php", "swift", "kotlin", "dockerfile", "toml", "md",
] as const;

/** Common aliases the model tends to emit → shiki ids. */
const ALIASES: Record<string, string> = {
  typescript: "ts", javascript: "js", py: "python", golang: "go", rs: "rust", shell: "bash", zsh: "bash",
  console: "bash", "c++": "cpp", "c#": "csharp", cs: "csharp", rb: "ruby", kt: "kotlin", yml: "yaml", markdown: "md",
  docker: "dockerfile", postgres: "sql", postgresql: "sql", mysql: "sql", node: "js", jsonc: "json", text: "plain",
  txt: "plain", plaintext: "plain",
};

const THEME_NAME = "css-vars";
const langSet = new Set<string>(HIGHLIGHT_LANGS);

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [createCssVariablesTheme({ name: THEME_NAME, variablePrefix: "--shiki-", variableDefaults: {}, fontStyle: true })],
      langs: [...HIGHLIGHT_LANGS],
    }).catch((e) => {
      highlighterPromise = null; // allow a later retry
      throw e;
    });
  }
  return highlighterPromise;
}

/** Resolve the model's `lang` string to a loaded shiki language id, or null for plain. */
export function resolveLang(lang: string): string | null {
  const key = lang.trim().toLowerCase();
  const id = ALIASES[key] ?? key;
  return langSet.has(id) ? id : null;
}

/** Plain tokens: one uncolored token per line (the renderer still gets line structure). */
export function plainLines(code: string): HighlightedLine[] {
  return code.split("\n").map((line) => [{ t: line }]);
}

export async function highlightCard(card: CodeCard): Promise<CodeCard> {
  try {
    const lang = resolveLang(card.lang);
    if (!lang) return { ...card, highlighted: plainLines(card.code) };
    const hl = await getHighlighter();
    const { tokens } = hl.codeToTokens(card.code, { lang: lang as BundledLanguage, theme: THEME_NAME });
    const highlighted: HighlightedLine[] = tokens.map((line) =>
      line.length === 0 ? [{ t: "" }] : line.map((tok) => (tok.color ? { t: tok.content, c: tok.color } : { t: tok.content })),
    );
    return { ...card, highlighted };
  } catch (e) {
    console.warn("[highlight] failed, returning card unhighlighted:", e instanceof Error ? e.message : e);
    return card;
  }
}

/** Highlight every code card in a batch; other cards pass through untouched. */
export async function highlightCards<T extends { type: string }>(cards: T[]): Promise<T[]> {
  return Promise.all(cards.map(async (c) => (c.type === "code" ? ((await highlightCard(c as unknown as CodeCard)) as unknown as T) : c)));
}
