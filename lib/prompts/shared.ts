import { z } from "zod";
import { BANNED_WORDS } from "@/lib/copy/banned";
import {
  BinaryCard, CheckpointCard, ClarifyCard, CodeCard, ConceptCard, DetourMarkerCard, DiagramCard,
  FallbackCard, HookCard, NoticeCard, PredictCard, RecapCard, RevealCard, SequenceCard, SliderCard,
  type CardType, StatCard, OpenCard, CrossroadsCard, WrapCard,
} from "@/lib/schemas/cards";
import type { LearnerState } from "@/lib/schemas/learner";
import type { Persona } from "@/lib/schemas/plan";
import type { Theme } from "@/lib/schemas/theme";
import { VisualSpec } from "@/lib/schemas/visual";

/**
 * Shared prompt building blocks. Everything here is byte-stable at module load
 * (no timestamps, no ids) so system prompts assembled from these blocks can be
 * prompt-cached. Card schemas are GENERATED from lib/schemas/cards.ts so the
 * prompt can never drift from the validator.
 */

export type Prompt = { system: string; user: string };

/**
 * Bump when PRIME_DIRECTIVE / WRITER_RULES / CARD_NOTES / JSON_ONLY change in a
 * way worth tracing. SHARED_FINGERPRINT below catches every edit automatically
 * (it hashes the assembled shared blocks + generated card schemas), so a logged
 * prompt version like "write.v2+shared.v1.9f3a1c2b" pins the exact prompt bytes.
 */
export const SHARED_VERSION = 2;

/** FNV-1a 32-bit — stable, dependency-free string hash. */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// ── output contract ────────────────────────────────────────────────────────────

export const JSON_ONLY =
  `output contract: respond with ONLY a JSON object matching the schema below. no prose before or after, no markdown, no code fences. ` +
  `the first character of your reply is "{" and the last is "}". strings contain plain text only — never HTML, markdown, or any markup. ` +
  `the AI fills schemas; the app renders them.`;

// ── prime directive (copy voice) ──────────────────────────────────────────────

export const BANNED_LIST = BANNED_WORDS.join(", ");

export const PRIME_DIRECTIVE =
  `prime directive: this must feel like a feed someone opened to kill time, never a course they enrolled in.
- never use school vocabulary in any user-facing string. banned words (any casing, plural too): ${BANNED_LIST}. say "bet", "hot take", "call it", "real or nah", "the footgun", "one idea", "rewind" instead.
- copy is lowercase, casual, punchy, feed-native. short sentences. no lecturing, no "in this section", no "let's explore".
- every card is complete on its own screen. if an idea needs more, it becomes two cards. respect every character cap.
- interactions are disguised as content: a question reads like a hot take or a bet, not an exam item.
- progress reads like flexing, not grading: "you now know more about X than most Y". never card counts like "3/47", never percentages of completion.
- reveal copy TEACHES, it doesn't grade: never "correct", "incorrect", "wrong answer", "right answer". a wrong tap still learns something.`;

/** Hard rules stapled into every writer/planner system prompt. */
export const WRITER_RULES =
  `hard rules (violations get the batch rejected):
1. no school vocabulary on screen (see banned words). none.
2. never fabricate facts that are not in the source. if the source doesn't cover something you need, say "the source doesn't cover this, but generally…" in the copy AND set that card's eyebrow to "off-source". prefer the source over general knowledge every time.
3. never repeat a metaphor already used (a list is provided). every recap/analogy is a NEW angle.
4. never exceed a character cap. counts are hard limits enforced by a validator; a card over a cap throws the whole batch away. aim for ~70% of each.
   the four that get overshot most, with an example of the RIGHT size:
     diagram node "label" ≤ 24 → "cache" / "write-ahead log" (two or three words, never a sentence)
     diagram node "sub" ≤ 40 → "in memory, not on disk"
     diagram edge "label" ≤ 20 → "on miss" / "flushes"
     concept "body" ≤ 320 → about 55 words, three or four sentences. write it, then cut a sentence.
   the rest: eyebrow 28 · hook headline 90 / sub 120 · concept headline 64 · binary prompt 140 / each option 40 / revealCopy 240 · predict prompt 140 / option 40 / revealHeadline 64 / revealBody 240 · sequence prompt 120 / item label 40 / revealCopy 240 · slider prompt 120 / label 40 / outputLabel 40 / insight 200 · reveal setup 140 / payoff 240 · diagram title 48 / tapNote 160 · code title 48 / code 1200 / annotation note 160 · checkpoint headline 80 / sub 160 · recap headline 64 / each beat 120.
5. never emit HTML, markdown, code fences, or any markup inside strings. plain text only (code cards hold raw code in the "code" field, that's it).
6. never reference card numbers or positions ("3/47", "card 2", "next slide"). never say "module", "unit", "section 3".
7. never grade: no "correct", "incorrect", "wrong", "right answer" in revealCopy/revealBody/insight. teach the payoff instead.
8. every card gets a fresh uuid v4 in "id".`;

// ── json-schema generation ────────────────────────────────────────────────────

const UUID_PROPS = { type: "string", format: "uuid" };

function compact(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(compact);
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (o.type === "string" && o.format === "uuid") return UUID_PROPS;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (k === "$schema" || k === "description") continue;
      out[k] = compact(v);
    }
    return out;
  }
  return node;
}

/** Zod → compact JSON schema (no $schema, uuid patterns collapsed). */
export function compactJsonSchema(schema: z.ZodType): unknown {
  return compact(z.toJSONSchema(schema, { unrepresentable: "any", io: "input" }));
}

export function schemaText(schema: z.ZodType): string {
  return JSON.stringify(compactJsonSchema(schema));
}

const CARD_ZOD: Record<CardType, z.ZodType> = {
  hook: HookCard,
  concept: ConceptCard,
  code: CodeCard.omit({ highlighted: true }),
  diagram: DiagramCard,
  binary: BinaryCard,
  predict: PredictCard,
  sequence: SequenceCard,
  slider: SliderCard,
  reveal: RevealCard,
  checkpoint: CheckpointCard,
  detour_marker: DetourMarkerCard,
  recap: RecapCard,
  fallback: FallbackCard,
  notice: NoticeCard,
  clarify: ClarifyCard,
  stat: StatCard,
  open: OpenCard,
  crossroads: CrossroadsCard,
  wrap: WrapCard,
};

/** Craft notes per type — what makes each card GOOD, beyond what the schema enforces. */
export const CARD_NOTES: Record<CardType, string> = {
  stat: `ONE number, rendered huge. "value" is the number as it should read ("80%", "3ms", "1.2M"); "label" says what it is; "context" is the single line that makes it mean something ("that's 10x fewer db reads, not 10% fewer"). optional "compare" gives the number something to sit next to. use this instead of a paragraph whenever the point IS a quantity.`,
  open: `they answer in their own words. "prompt" asks something a person can actually say out loud in a sentence ("in your own words: why does the cache restart hurt?"). "rubric" is for the grader only and never shown — list what a good answer contains. "modelAnswer" is what they see if they'd rather not type. keep it to one honest question, not an interrogation.`,
  crossroads: `never write this — the app inserts it at topic boundaries.`,
  wrap: `never write this unless asked for a wrap — the whole thread in 3–5 beats, each ≤ 120 chars, the way you'd summarise it to a friend who walked in late. "openThread" is the one thing still unexplored, phrased as an invitation.`,
  hook: `one bold claim or question in huge type (headline ≤ 90 chars). optional sub. sets up the next 2–3 cards. no explanation here — tension only.`,
  concept: `ONE idea. body ≤ 320 chars (~55 words). headline is the idea in ≤ 64 chars. optional visual: {kind:"stat",value,label} for a number that lands, {kind:"icon",icon} from the icon list, {kind:"ascii",lines} for a tiny text sketch, {kind:"spark",values} for a trend.`,
  code: `real, runnable-looking code, ≤ ~14 short lines, ≤ 1200 chars, "lang" is a highlighter id (ts, js, python, bash, sql, go, rust, json...). annotations point at 1-based lines and say what that line is doing and why it matters. tapping a line reveals its note.`,
  diagram: `structure only; the app draws it. 2–8 nodes with short labels (≤ 24 chars), edges reference node ids. pick the variant that fits the shape: flow (pipeline), boxes (parts), timeline (order in time), compare (A vs B), cycle (loop), layers (stack). set emphasis:true on the node that matters and put a tapNote on it.`,
  binary: `a two-way bet. prompt reads like a hot take ("hot take: killing the cache takes the site down. real or nah?"). options are two short labels (≤ 40 chars). revealCopy is the payoff — teaches after ANY tap. difficulty 1–5.`,
  predict: `a "what happens next?" scenario. 2–4 short options, one correctIndex. revealHeadline + revealBody are shown on the NEXT screen, so they must stand alone. difficulty 1–5.`,
  sequence: `3–6 items listed in the CORRECT order (the app shuffles them). prompt names the process. revealCopy explains why the order matters. difficulty 1–5.`,
  slider: `one input drives one output live. label/min/max/step/defaultValue/unit for the input; expression is a formula in x using only numbers, x, + - * / ^ %, parentheses, sqrt log ln exp abs min max pow floor ceil round sin cos. outputLabel/outputUnit/outputFormat for the result. insight is one line that reframes what they just felt.`,
  reveal: `tap-to-flip. setup is one line of tension (≤ 140), payoff is hidden until tap (≤ 240). a twist, a number, a myth busted.`,
  checkpoint: `a milestone flex in the subject's world: headline like "you now know more about X than most Y" (≤ 80). optional sub teases what's next. optional stat is a flex ("7", "in a row"), never progress or percent. optional visual.`,
  recap: `headline + exactly 3 beats (each ≤ 120 chars) that re-explain ONE idea through a NEW metaphor; put the metaphor phrase in "metaphor" (≤ 80). never reuse a metaphor from the used list.`,
  detour_marker: `internal: opens/closes a question detour. label ≤ 60.`,
  fallback: `internal only. never write this.`,
  notice: `internal only. never write this.`,
  clarify: `setup question as a card: key, prompt (≤ 140), 2–3 tap options (≤ 40 each).`,
};

const VISUAL_REF = { $ref: "#/visual" };

/** Card schema with the (large, shared) VisualSpec replaced by a $ref so it's emitted once. */
function cardSchemaJson(type: CardType): string {
  const js = compactJsonSchema(CARD_ZOD[type]) as { properties?: Record<string, unknown> };
  if (js.properties && "visual" in js.properties) js.properties.visual = VISUAL_REF;
  return JSON.stringify(js);
}

const VISUAL_BLOCK = `shared visual spec — wherever a schema says {"$ref":"#/visual"}, use one of these objects (or omit the field):\n${schemaText(VisualSpec)}`;

/** JSON schemas + craft notes for the given card types, in a stable order. */
export function cardSchemaBlock(types: readonly CardType[]): string {
  const ordered = (Object.keys(CARD_ZOD) as CardType[]).filter((t) => types.includes(t));
  const parts = ordered.map((t) => `### ${t}\n${CARD_NOTES[t]}\nschema: ${cardSchemaJson(t)}`);
  const usesVisual = ordered.some((t) => t === "hook" || t === "concept" || t === "reveal" || t === "checkpoint");
  return `card schemas (every card is an object with "type" set to one of: ${ordered.join(", ")}):\n\n${parts.join("\n\n")}${usesVisual ? `\n\n${VISUAL_BLOCK}` : ""}`;
}

/** Common base fields the writer must set on EVERY card. */
export const BASE_CARD_FIELDS =
  `every card carries: "id" (uuid v4, fresh), "type", "topicNodeId" (given to you), "detourId" (given to you; null on the main thread), optional "eyebrow" (≤ 28 chars, tiny label like "the footgun", "hot take", "0x03", "off-source").`;

// ── theme + persona blocks ────────────────────────────────────────────────────

export function personaBlock(p: Persona): string {
  const name = p.name ? `name: ${p.name}\n` : "";
  const sample = p.voiceSample ? `voice sample: ${p.voiceSample}\n` : "";
  return `persona (your voice — jarvis-tier intelligence is constant; the flavor is this):
${name}traits: ${p.traits.join("; ")}
verbal tics: ${p.tics.join("; ")}
humor: ${p.humor}
never does: ${p.neverDoes}
${sample}`.trimEnd();
}

export function themeGroundingBlock(t: Pick<Theme, "name" | "mood" | "signature">): string {
  return `visual identity of this session (write INTO this world; the app renders it):
theme: ${t.name}
mood: ${t.mood}
signature device: ${t.signature}`;
}

// ── learner state ─────────────────────────────────────────────────────────────

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function difficultyFor(state: LearnerState): number {
  return clamp(state.globalLevel + state.directives.difficultyDelta, 1, 5);
}

export function learnerSummary(state: LearnerState): string {
  const last = state.rolling.last10Interactive;
  const hits = last.filter(Boolean).length;
  const rate = last.length ? Math.round((hits / last.length) * 100) : null;
  const d = state.directives;
  const lines = [
    `level ${state.globalLevel}/5 (1 = total beginner, 5 = practitioner). difficulty delta ${d.difficultyDelta >= 0 ? "+" : ""}${d.difficultyDelta} → write interactives at difficulty ${difficultyFor(state)}.`,
    rate === null ? `no interactive results yet.` : `recent bets: ${hits}/${last.length} landed (${rate}%).`,
    state.rolling.avgDwellMs ? `avg dwell ${Math.round(state.rolling.avgDwellMs / 100) / 10}s per card.` : ``,
    `pace: ${d.pace}${d.pace === "compress" ? " → they're skimming: bigger claims, fewer words, fewer cards per idea." : "."}`,
    d.scaffoldNext.length ? `needs a gentler re-angle before the next bet on: ${d.scaffoldNext.join(", ")}.` : ``,
    d.recapDue ? `recap due on: ${d.recapDue}.` : ``,
    d.reinforce.length ? `they asked about these in detours — reinforce: ${d.reinforce.join(", ")}.` : ``,
    `prefs: chill mode ${state.prefs.chillMode ? "ON (no bets, no sliders — consumption only)" : "off"}, depth ${state.prefs.depthPreset}, simpler taps ${state.prefs.simplerTaps}, deeper taps ${state.prefs.deeperTaps}.`,
  ].filter(Boolean);
  return lines.join("\n");
}

export function difficultyDirective(state: LearnerState): string {
  const delta = state.directives.difficultyDelta;
  const diff = difficultyFor(state);
  if (delta > 0) {
    return `difficulty directive: they're cruising (>90% recently). write interactives at difficulty ${diff} and add curveballs: plausible-wrong options, "which is the LIE" formats, edge cases the source actually covers.`;
  }
  if (delta < 0) {
    return `difficulty directive: they're missing (<65% recently). write interactives at difficulty ${diff}, keep options clearly distinct, and land the idea in a concept card BEFORE any bet on it.`;
  }
  return `difficulty directive: on target. write interactives at difficulty ${diff}.`;
}

// ── corpus slicing ────────────────────────────────────────────────────────────

const HEADING_RE = /^(#{1,6}\s+.+|[A-Z][A-Za-z0-9 ,:'’()\-]{2,70}|\d+(\.\d+)*\.?\s+[A-Za-z].{2,70})$/;

/**
 * Sample heading-like lines (markdown headings, short Title-Case lines, numbered
 * headings), spread evenly across the text so the whole shape is visible.
 */
export function sampleHeadings(text: string, max = 40): string[] {
  const all: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.length > 80) continue;
    if (HEADING_RE.test(line) && !/[.!?]$/.test(line.replace(/^#+\s*/, ""))) all.push(line.replace(/^#+\s*/, ""));
  }
  if (all.length <= max) return all;
  const step = all.length / max;
  const out: string[] = [];
  for (let i = 0; i < max; i++) out.push(all[Math.min(all.length - 1, Math.floor(i * step))]);
  if (out[out.length - 1] !== all[all.length - 1]) out[out.length - 1] = all[all.length - 1];
  return out;
}

/**
 * Bound a corpus for a prompt: the first `maxChars` characters, plus a sample
 * of headings from the remainder so the planner can still see the whole shape.
 */
export function sliceCorpus(text: string, maxChars = 24_000): string {
  const t = text ?? "";
  if (t.length <= maxChars) return t;
  const head = t.slice(0, maxChars);
  const rest = t.slice(maxChars);
  const headings = sampleHeadings(rest);
  const omitted = `[… ${rest.length.toLocaleString("en-US")} more characters omitted …]`;
  const sample = headings.length ? `\nheadings sampled from the omitted part:\n- ${headings.join("\n- ")}` : "";
  return `${head}\n\n${omitted}${sample}`;
}

/** Bounded, deterministic JSON for prompt context (never throws on cycles/bigints). */
export function jsonForPrompt(value: unknown, maxChars = 4_000): string {
  let s: string;
  try {
    s = JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? String(v) : v)) ?? "null";
  } catch {
    s = String(value);
  }
  return s.length > maxChars ? s.slice(0, maxChars) + "…" : s;
}

/** Render-only fields (server-side highlighter output, ordering keys) the model must never see or echo. */
const RENDER_ONLY_KEYS = new Set(["highlighted", "idx", "interaction", "viewedAt", "createdAt"]);

/**
 * A card as prompt context: the copy the person is looking at, minus render-only
 * payload (a code card's shiki `highlighted` tokens dwarf its copy and would eat
 * the char budget mid-token-array).
 */
export function cardForPrompt(card: unknown, maxChars = 2_000): string {
  if (!card || typeof card !== "object" || Array.isArray(card)) return jsonForPrompt(card, maxChars);
  const slim: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(card as Record<string, unknown>)) if (!RENDER_ONLY_KEYS.has(k)) slim[k] = v;
  return jsonForPrompt(slim, maxChars);
}

export function bullets(items: readonly string[]): string {
  return items.length ? items.map((s) => `- ${s}`).join("\n") : "- (none)";
}

// ── versioning ────────────────────────────────────────────────────────────────

const ALL_CARD_TYPES = Object.keys(CARD_ZOD) as CardType[];

/** 8-hex fingerprint of every shared prompt block + generated card schema (see SHARED_VERSION). */
export const SHARED_FINGERPRINT = hashStr(
  [JSON_ONLY, PRIME_DIRECTIVE, WRITER_RULES, BASE_CARD_FIELDS, cardSchemaBlock(ALL_CARD_TYPES)].join("\n"),
).toString(16).padStart(8, "0");

/**
 * The prompt version logged with every call: the file's PROMPT_VERSION, any
 * borrowed system prompt's version (detour borrows write's), then the shared
 * blocks' version + fingerprint — so a regression is traceable to the exact
 * prompt bytes even when only shared.ts or a card schema changed.
 */
export function loggedPromptVersion(fileVersion: string, ...borrowed: string[]): string {
  return [fileVersion, ...borrowed, `shared.v${SHARED_VERSION}.${SHARED_FINGERPRINT}`].join("+");
}
