import { z } from "zod";
import { BANNED_WORDS } from "@/lib/copy/banned";
import {
  BinaryCard, CheckpointCard, ClarifyCard, CodeCard, ConceptCard, DetourMarkerCard, DiagramCard,
  FallbackCard, HookCard, NoticeCard, PredictCard, RecapCard, RevealCard, SequenceCard, SliderCard,
  type CardType, StatCard, OpenCard, ScrubCard, SpotCard, CrossroadsCard, WrapCard,
} from "@/lib/schemas/cards";
import type { LearnerState } from "@/lib/schemas/learner";
import type { Persona } from "@/lib/schemas/plan";
import type { Storyline } from "@/lib/schemas/session";
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
export const SHARED_VERSION = 3;

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
   the rest: eyebrow 28 · hook headline 90 / sub 120 · concept headline 64 · binary prompt 140 / each option 40 / revealCopy 240 · predict prompt 140 / option 40 / revealHeadline 64 / revealBody 240 · sequence prompt 120 / item label 40 / revealCopy 240 · slider prompt 120 / label 40 / outputLabel 40 / insight 200 · reveal setup 140 / payoff 240 · diagram title 48 / tapNote 160 · code title 48 / code 1200 / annotation note 160 · checkpoint headline 80 / sub 160 · recap headline 64 / each beat 120 · stat value 12 / label 48 / context 160 · open prompt 160 / rubric 240 / modelAnswer 280 · terms: at most 3, term 32 / gloss 140.
5. never emit HTML, markdown, code fences, or any markup inside strings. plain text only (code cards hold raw code in the "code" field, that's it).
6. never reference card numbers or positions ("3/47", "card 2", "next slide"). never say "module", "unit", "section 3".
7. never grade: no "correct", "incorrect", "wrong", "right answer" in revealCopy/revealBody/insight. teach the payoff instead.
8. every card gets a fresh uuid v4 in "id".
9. never write two prose cards in a row. a prose card is a "concept" or a "recap" — headline plus a block of text. two of them back to back is a wall, and a wall is where people leave.
10. never write "as you know", "obviously", "simply", "of course", "everyone knows", "needless to say". they teach the reader that they're the only one who doesn't get it.`;

// ── show, don't tell ──────────────────────────────────────────────────────────

/**
 * The single biggest quality lever, from real reader feedback: "70% of the cards
 * are literally the same, just a title screen + a verbose paragraph." Naming the
 * failure mode and routing each point to a concrete card type is what fixes it —
 * examples move this model far more than rules, so both are here.
 */
export const SHOW_DONT_TELL =
  `SHOW, DON'T TELL — the thing that decides whether this feed is good.

the failure mode has a name: THE PARAGRAPH DECK. headline, paragraph. headline, paragraph. every card the same shape, every card a small wall of text. it is what a tired writer produces and it is exactly where people close the app. if two of your cards could swap headlines and still make sense, you wrote a paragraph deck. start over.

before you write a card, find the most CONCRETE thing you have about that point, and let it choose the type:
- a number, a ratio, a duration, a count, a price → "stat". the number IS the card.
- parts wired together, a mechanism, a path a request takes → "diagram". you give structure, the app draws it.
- things that happen in an order → "sequence". they drag it into order and feel the order.
- real code, a command, a config, a query → "code". annotate the one line that matters.
- a relationship you only understand by moving it → "slider". they drag, the number moves.
- a twist, a myth, a "you'd think X but" → "reveal". setup, then payoff on tap.
- a claim people get wrong → "binary" or "predict". the wrong tap teaches too.
- a point they should be able to say back in their own words → "open".
- a milestone worth flexing → "checkpoint".
ONLY when none of those fit is the point a "concept" — and then it is ≤ 55 words and it carries a "visual".

worked examples (weak card on the left, what to write instead on the right):

weak: {"type":"concept","headline":"cache hit rates matter","body":"the hit rate of a cache determines how much load reaches the database. a higher hit rate means fewer reads hit the underlying store, which reduces latency and cost. going from a 90% hit rate to a 99% hit rate is a significant improvement in the number of requests that must be served from disk."}
strong: {"type":"stat","eyebrow":"the math nobody does","value":"10x","label":"fewer db reads","context":"90% → 99% hit rate isn't 9% better. it's ten times fewer reads reaching disk.","compare":{"value":"9%","label":"what it looks like"}}
why: the whole point was a quantity. a quantity gets to be huge on screen, not buried in the fourth sentence.

weak: {"type":"concept","headline":"how a cache-aside read works","body":"when a request arrives, the application first checks the cache. if the value is present, it is returned. if it is not present, the application reads from the database, writes the value into the cache, and then returns it to the caller."}
strong: {"type":"diagram","variant":"flow","title":"a miss, start to finish","nodes":[{"id":"a","label":"request"},{"id":"b","label":"cache","sub":"in memory","emphasis":true},{"id":"c","label":"database","sub":"on disk"}],"edges":[{"from":"a","to":"b","label":"ask"},{"from":"b","to":"c","label":"on miss"},{"from":"c","to":"b","label":"write back"}],"tapNotes":{"b":"the write-back happens before the answer goes out, so the next ask is a hit."}}
why: it was a mechanism the whole time. a mechanism is a shape, and a shape is a picture.

weak: {"type":"concept","headline":"cache invalidation is hard","body":"one of the difficult parts of caching is knowing when the stored value no longer matches the source of truth. this is commonly described as one of the hardest problems in computer science."}
strong: {"type":"reveal","eyebrow":"the footgun","setup":"the hard part of a cache isn't storing the answer…","payoff":"it's knowing the moment your stored answer became a lie. everything else is plumbing.","terms":[{"term":"invalidation","gloss":"throwing out a cached answer once it stops matching the real thing"}]}
why: it was a twist. a twist gets a beat of tension and a tap, not a summary.`;

// ── don't skip basics, don't assume ───────────────────────────────────────────

/**
 * The other half of the same feedback: "better explanations but not more text —
 * quality > quantity, and don't skip over basics or assume stuff." `terms` is the
 * mechanism that lets a card be beginner-safe without spending screen words.
 */
export const NO_ASSUMING =
  `don't skip the basics. don't assume.
- your reader is smart, curious, and has NOT read the source. everything they know about this, they know because a card told them.
- the FIRST time you use a word a curious outsider wouldn't have, do one of two things: gloss it inline in ≤ 6 words ("a ttl — how long before it expires — of 60s"), or add it to that card's "terms" array: {"term":"ttl","gloss":"how long a cached answer is allowed to live"}. the app underlines the word wherever it appears in the card and a tap shows the gloss. PREFER terms — it costs zero words on screen, which is the whole budget problem.
- terms is for words you actually used on that card, at most 3, and only the first time. don't gloss "database".
- say what a thing is FOR before you say how it works. purpose, then mechanism.
- concrete beats abstract every single time: one real example, one real number, one real name — never one more adjective.
- quality over quantity means FEWER WORDS PER CARD and MORE CARDS THAT EACH DO ONE THING. if a card is doing two things, it is two cards.
- if you catch yourself writing a sentence that only restates the headline, delete it. that sentence is why the last version felt like reading the same card forever.`;

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
  scrub: ScrubCard,
  spot: SpotCard,
  crossroads: CrossroadsCard,
  wrap: WrapCard,
};

/** Craft notes per type — what makes each card GOOD, beyond what the schema enforces. */
export const CARD_NOTES: Record<CardType, string> = {
  stat: `ONE number, rendered huge — the fastest card in the deck to read, so reach for it often. "value" is the number exactly as it should read ("80%", "3ms", "1.2M", "$0.02"); "label" says what the number IS (≤ 48); "context" is the single line that makes it land (≤ 160) — "that's 10x fewer db reads, not 10% fewer", never a restatement of the label. optional "compare" gives it something to sit beside ({"value":"9%","label":"what it looks like"}). RULE: any time the point of a card is a quantity, it is a stat card, not a paragraph containing a number. optional "terms" for one word in the label/context a newcomer wouldn't have.
example: {"type":"stat","eyebrow":"the math nobody does","value":"10x","label":"fewer db reads","context":"90% → 99% hit rate isn't 9% better. it's ten times fewer reads reaching disk.","compare":{"value":"9%","label":"what it looks like"}}`,
  open: `they type an answer in their own words, and the reply is written against what THEY said. this is the "explain it back" beat and it is the one people actually remember — aim for roughly one per topic, placed after the idea has landed (never as the first card on a new idea).
"prompt" (≤ 160) is one honest question a person could answer out loud in a sentence: "in your own words — why does an empty cache hurt the database?". not two questions. not "list the three…".
"placeholder" (≤ 48) is the greyed hint in the box ("say it however you'd say it").
"rubric" (≤ 240) is for the grader only and NEVER on screen: the 2–3 things a good answer contains, written as a checklist fragment.
"modelAnswer" (≤ 280) is what they can reveal if they'd rather not type — a real answer in your voice, not a rubric restated.
example: {"type":"open","eyebrow":"say it back","prompt":"in your own words — why does an empty cache hurt the database?","placeholder":"however you'd say it","rubric":"every request becomes a miss; all misses land on the db at once; the db was never sized for that","modelAnswer":"nothing is in memory, so every single ask goes to the database at the same moment — and it was only ever sized for the misses.","difficulty":2}`,
  scrub: `they drag a meter across a few moments and watch the thing change. no right answer and no score — the payoff is FEELING the shape of a relationship, which a paragraph about it never gives you. reach for it whenever the point is "as X goes up, Y does this".
"title" (\u2264 48) names what they're dragging through. "meterLabel" (\u2264 28) is what the meter IS ("asks answered from memory", "temperature").
"frames" are 3\u20136 stops IN ORDER, and the SHAPE of their "level" (0\u2013100) is the whole point \u2014 make it rise, crash, or double back for a reason. each stop has a "label" (\u2264 20, in its own words: "3am", "the restart") and a "caption" (\u2264 100) saying what is true there. a flat line teaches nothing.
"insight" (\u2264 160) is the one line that reframes what they just felt.
example: {"type":"scrub","eyebrow":"drag it","title":"what the cache is worth, hour by hour","meterLabel":"asks answered from memory","frames":[{"label":"3am","caption":"barely anything repeats, so almost every ask goes the long way round.","level":14},{"label":"noon","caption":"nearly every ask already has its answer sitting in memory.","level":88},{"label":"the restart","caption":"memory is wiped and all of it lands on the database in one second.","level":3}],"insight":"it is worth the most at exactly the moment losing it hurts the most."}`,
  spot: `find the one line that matters inside real material. reads like "spot the lie", not like a bet with four options \u2014 and because the pieces ARE the content, a wrong tap still leaves them having read the whole thing.
"prompt" (\u2264 110) says what they're hunting ("one line here quietly serves the wrong answer forever. which one?").
"pieces" are 3\u20137 rows shown in order, each "text" \u2264 48 chars. EXACTLY one or two carry "hit": true. every piece should earn a "note" (\u2264 120) \u2014 why it is, or is not, the one \u2014 because that note is what a miss teaches.
set "mono": true when the pieces are code, config or log lines (they render in the mono face). the wrong pieces must be plausible: a row nobody would ever tap is a wasted row.
"revealCopy" (\u2264 200) is the payoff once every hit is found. difficulty 1\u20135.
example: {"type":"spot","eyebrow":"one of these bites","prompt":"one line here quietly serves the wrong answer forever. which one?","pieces":[{"text":"const hit = await redis.get(key)","hit":false,"note":"asking the fast thing first is the whole pattern."},{"text":"await redis.set(key, row)","hit":true,"note":"no TTL. this answer never expires, so it can be wrong until someone restarts the box."},{"text":"return row","hit":false,"note":"fine \u2014 the write already happened above it."}],"mono":true,"revealCopy":"a set with no TTL is a promise you can't keep. the row changes, the copy doesn't, and nothing tells it to go.","difficulty":2}`,
  crossroads: `never write this — the app inserts it at topic boundaries.`,
  wrap: `the ending, only when asked for: the whole thread in 3–5 beats, each ≤ 120 chars, the way you'd catch up a friend who walked in late. beats are in order and each one is a claim, not a topic name ("a cache is a bet on repetition" — not "we covered caching"). optional "stat" is a flex, never progress. "openThread" (≤ 140) is the one thing still unexplored, phrased as an invitation to come back.`,
  hook: `one bold claim or question in huge type (headline ≤ 90 chars). optional sub. sets up the next 2–3 cards. no explanation here — tension only.`,
  concept: `the LAST RESORT type, not the default. use it only when the point is not a number (stat), a mechanism (diagram), an order (sequence), code (code), a felt relationship (slider), a twist (reveal) or a claim (binary/predict). when it survives that test: ONE idea, headline ≤ 64, body ≤ 320 (~55 words — write it, then cut a sentence), and it MUST carry a "visual": {kind:"stat",value,label} for a number that lands, {kind:"icon",icon} from the icon list, {kind:"ascii",lines} for a tiny text sketch, {kind:"spark",values} for a trend. add "terms" for any word in it a curious outsider wouldn't have.`,
  code: `real, runnable-looking code, ≤ ~14 short lines, ≤ 1200 chars, "lang" is a highlighter id (ts, js, python, bash, sql, go, rust, json...). annotations point at 1-based lines and say what that line is doing and why it matters. tapping a line reveals its note.`,
  diagram: `structure only; the app draws it. 2–8 nodes with short labels (≤ 24 chars), edges reference node ids. pick the variant that fits the shape: flow (pipeline), boxes (parts), timeline (order in time), compare (A vs B), cycle (loop), layers (stack). set emphasis:true on the node that matters and put a tapNote on it.`,
  binary: `a two-way bet. prompt reads like a hot take ("hot take: killing the cache takes the site down. real or nah?"). options are two short labels (≤ 40 chars). revealCopy is the payoff — teaches after ANY tap. difficulty 1–5.`,
  predict: `a "what happens next?" scenario. 2–4 short options, one correctIndex. revealHeadline + revealBody are shown on the NEXT screen, so they must stand alone. difficulty 1–5.`,
  sequence: `3–6 items listed in the CORRECT order (the app shuffles them). prompt names the process. revealCopy explains why the order matters. difficulty 1–5.`,
  slider: `one input drives one output live. label/min/max/step/defaultValue/unit for the input; expression is a formula in x using only numbers, x, + - * / ^ %, parentheses, sqrt log ln exp abs min max pow floor ceil round sin cos. outputLabel/outputUnit/outputFormat for the result. insight is one line that reframes what they just felt.`,
  reveal: `tap-to-flip. setup is one line of tension (≤ 140), payoff is hidden until tap (≤ 240). a twist, a number, a myth busted. the setup must not give the payoff away — "the hard part of a cache isn't storing the answer…" then the tap. optional "terms" for a word the payoff leans on.`,
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

/** The one number the writer is handed. `level` already carries the dial and what they've earned. */
export function difficultyFor(state: LearnerState): number {
  return clamp(state.level, 1, 5);
}

export function learnerSummary(state: LearnerState): string {
  const last = state.rolling.last10Interactive;
  const hits = last.filter(Boolean).length;
  const rate = last.length ? Math.round((hits / last.length) * 100) : null;
  const d = state.directives;
  const lines = [
    `they dialled ${state.globalLevel}/5 (1 = total beginner, 5 = practitioner); their answers read ${difficultyFor(state)}/5 → write interactives at difficulty ${difficultyFor(state)}.`,
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
  const diff = difficultyFor(state);
  const delta = diff - state.globalLevel;
  if (delta > 0) {
    return `difficulty directive: they're cruising (>90% recently). write interactives at difficulty ${diff} and add curveballs: plausible-wrong options, "which is the LIE" formats, edge cases the source actually covers.`;
  }
  if (delta < 0) {
    return `difficulty directive: they're missing (<65% recently). write interactives at difficulty ${diff}, keep options clearly distinct, and LAND the idea before any bet on it — a diagram or a stat lands it better than another paragraph, and put the words they're missing in "terms".`;
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

// ── variety + through-line ────────────────────────────────────────────────────

/**
 * What the last few cards WERE, as shapes. The writer reaching for `concept`
 * every time is the #1 complaint; the fix is telling it what it just used and
 * that repeating a shape is not allowed.
 */
export function recentTypesBlock(types: readonly CardType[] | undefined): string {
  if (!types || !types.length) return `card shapes just used: none yet — this is the opening. lead with the most concrete thing in the source.`;
  const last = types.slice(-8);
  const prose = last.slice(-2).every((t) => t === "concept" || t === "recap");
  return [
    `card shapes just used (oldest → newest): ${last.join(" → ")}.`,
    `pick DIFFERENT shapes. the last card was a "${last[last.length - 1]}" — your first card is not that.`,
    prose ? `warning: the last two were prose cards. the next card must NOT be a "concept" or a "recap". show it instead: stat, diagram, sequence, code, slider, reveal.` : null,
    `if "stat", "diagram", "code" or "slider" is missing from that list, that is the shape you are reaching for now.`,
  ].filter(Boolean).join("\n");
}

/**
 * The session's through-line. "last 6 cards" keeps local continuity but loses the
 * plot 40 slides deep; the spine is what stops the feed drifting into a different
 * subject and answers "am I still on the same thing?".
 */
export function storylineBlock(s: Storyline | null | undefined): string {
  if (!s) return `through-line: not set yet — stay on the node brief and the source.`;
  return [
    `the through-line of this whole session (STAY ON IT — every card belongs to this story):`,
    `spine: ${s.spine}`,
    `already landed:\n${bullets(s.covered)}`,
    `heading toward: ${s.next}`,
    `do not re-land something in "already landed". do not wander off the spine; if the source pulls somewhere else, connect it back in the copy.`,
  ].join("\n");
}

// ── versioning ────────────────────────────────────────────────────────────────

const ALL_CARD_TYPES = Object.keys(CARD_ZOD) as CardType[];

/** 8-hex fingerprint of every shared prompt block + generated card schema (see SHARED_VERSION). */
export const SHARED_FINGERPRINT = hashStr(
  [JSON_ONLY, PRIME_DIRECTIVE, WRITER_RULES, SHOW_DONT_TELL, NO_ASSUMING, BASE_CARD_FIELDS, cardSchemaBlock(ALL_CARD_TYPES)].join("\n"),
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
