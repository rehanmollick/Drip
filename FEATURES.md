# FEATURES.md — everything DRIP does, including the parts it hides

DRIP: TikTok's format, a great teacher's brain. Paste anything → an infinite, adaptive,
snap-scrolling feed that teaches it. This is the full inventory — the features you can see, the
machinery you can't, and the tech it stands on. The in-app "how this works" panel is the short
version of this file.

---

## What you see

**Paste anything, get a feed.** A sentence, a wall of text, a URL, a YouTube link, a repo, a .txt/.md
file. One wait while it reads (narrated, not a spinner), then the first cards drop — and there is
never a second wait after that.

**Every subject gets its own identity.** A planner model derives a full visual world from the
subject itself: palette, two typefaces + a mono, texture (grain/grid/scanlines/dots), a motion
personality, and ONE signature device (hex addresses, water-line underlines, cursor blink, rubber
stamps…) that appears on hooks and checkpoints. Caching docs get a terminal; tide pools get a field
notebook. Themes are repaired for contrast automatically — never rejected, always nudged until the
ink holds.

**Every subject gets its own narrator.** One persona for the whole thread — traits, verbal tics, a
humor register, one thing it never does, and a single *analogy world* every comparison comes from.
The planner doesn't just describe the voice; it writes a full sample card in it, so the writer
imitates instead of inventing.

**Cards, not paragraphs.** Nineteen card shapes, thirteen writable by the model:
hooks, concepts (the last resort, capped at ~55 words), code with tap-to-annotate lines, six diagram
variants, stat cards where the number is the message, binary bets, predict-the-outcome, drag-into-
order sequences, live sliders driving a real formula, tap-to-flip reveals, checkpoints,
say-it-back open answers, **scrub** (drag a moment across time — the curve is the story), and
**spot** (find the one line that matters inside real material). Interactions are disguised as
content: a question reads like a hot take, never an exam item.

**The depth rail.** A hairline on the right edge, in the axis the feed actually moves: solid above
the thumb is what you've read, bright below is what actually exists, and the bottom edge pulses only
while a batch is genuinely being written — the rail grows as real cards land, and never lays out a
path for cards that don't exist yet. A fork shows a gate mark; a wrapped thread gets a hard end cap.
It swells while you scroll and fades when you rest. Long-press → the thread map: where you've been,
where you are ("you're here"), what's planned (inert dots — plans live here, not on the rail), any
detours hanging off the main thread, and the app's only number: "~N min left in this thread",
computed from your own reading pace.

**It asks before piling on.** At the end of every topic the feed stops at a crossroads: keep going /
one more layer here / ask something / wrap it up. Built locally in zero milliseconds — asking is
never a spinner. Nothing more is written until you choose.

**A real ending.** "wrap it up" produces an ending card — the whole thread in a few beats, plus the
one door left open as an invitation back. The session archives; the feed stays scrollable forever.

**Ask anything, mid-scroll.** The ask bar triages mechanically: answerable in two sentences → an
inline reply in the narrator's voice; bigger → a short marked side-thread that splices in right
after your current card and hands you back to the main story where you left it.

**The dial.** Tap *simpler* or *deeper* on a card and everything unread is rewritten to match — with
a one-line nod back in the narrator's voice. Viewed cards never change; history is immutable.

**Chill mode.** Drops every ask — no bets, no drags, no typing, nothing measured. Just the show.
Enforced in code after validation, not just requested in the prompt.

**Home is a shelf of covers.** Each session's tile is typeset in its own palette, texture, signature
and display face, with a state line in feed voice ("parked at a fork", "fresh cards waiting",
"wrapped — the thread's still there"), quiet recency, and a wordless depth sliver. Depth presets
explain themselves; drafts survive an accidental dismiss; suggested starts teach by example.

---

## What's working underneath (the hidden layer)

**Through-line memory.** The session carries a storyline — spine / covered / next — seeded from the
planner's argument and advanced as topics close. Card 40 still knows what card 1 promised. Detours
re-anchor to it on the way back.

**Difficulty that reads your answers.** A Rasch-style ability estimate with a guessing floor: a
lucky tap on a coin-flip barely moves it; a real answer on a hard card moves it properly. Eight
straight hits buy at most one difficulty notch, with a deadband so it doesn't chatter. Every scored
card carries a difficulty rating the model wrote — the estimator is what finally reads it.

**Spaced callbacks.** Every card carries an invisible anchor slug naming the idea it teaches. Ideas
come back as fresh bets — in a NEW shape, never the earlier wording, never announced — after ~10
cards, again after ~26, retiring after two wins. Never about something you haven't read yet, never
in the first dozen cards, never while you're skimming, at most one out-of-topic callback per three
batches. This is spaced retrieval — the largest learning effect ever measured (g≈0.74) — wearing a
feed's clothes.

**Bet before explain.** Within one idea, a scored card sorts ahead of the concept that resolves it:
you guess first, the next card pays it off. The pretesting effect, for free, because the writer
already wrote both cards.

**Causal threading.** Each card in a batch opens off the previous card's idea (because / so / but),
so a batch reads as an argument, not a deck of facts. Roughly one card in five, with jitter, is
written as the batch's jackpot — the stat that reframes everything.

**Shape mixing, enforced in code.** Never two prose cards adjacent; at most two concepts per any
four cards; every stretch of three or more carries something to look at. The writer literally cannot
emit a concept when the governor narrows the schema — not a request, a constraint.

**Vocabulary watchdog.** The source's own dictionary (minus ~1,200 common words) is checked against
what's been glossed; unintroduced jargon gets named verbatim in the next batch's directives. The tap
glossary (underlined words, max 3 per card) is fed back on every call so nothing is glossed twice.

**Pace reading.** Median dwell under ~1.8s across five reading cards → the writing compresses:
bigger claims, fewer words, fewer cards per idea. The dwell clock pauses when the app backgrounds
and hard-caps at 60s, so locking your phone never reads as confusion.

**Stuck detection.** 25+ seconds of active reading on one teaching card, or a scroll-back to re-read
one → a fresh three-beat retake lands a couple of cards ahead, on a metaphor it hasn't used before,
and the idea gets asked about sooner. A deliberate jump from the map doesn't count.

**Gentle re-angle.** Hit rate dipping under ~65% fills the next stretch with a re-angle of the
wobbly idea before it's bet on again. Two straight misses on one concept → an immediate retake.

**Setup taps.** A genuinely vague one-liner gets up to three tap-to-answer setup cards; the unread
feed re-plans around your answers while everything you've seen stays put.

**Flex-only progress.** No counts, no percentages, no scores, ever. Checkpoints ("you now know more
about X than most Y") only land when none appeared in the last 12 cards. Reveal cards you called
early get a two-word "called it" nod.

---

## The safety rails

- **The card under your thumb is sacred.** Nothing is ever inserted above the furthest card you've
  seen; the slide you're on never changes identity or slot, even while batches land under you.
- **The feed cannot crash on content.** Every card is schema-validated before it renders; a bad
  batch is retried once with the error attached; a second failure becomes one themed fallback card.
- **Failure is data.** Budget caps, offline, model errors — all become themed in-feed cards in the
  session's voice. Never a spinner mid-scroll, never a raw error string.
- **Daily ceiling.** A hard cap on model calls per day (default 500), counted before every call,
  failing closed. Hitting it mid-session produces one notice in the persona's voice.
- **Offline grace.** The written runway keeps scrolling; your taps queue and land the moment you're
  back; one themed "back online soon" card at the frontier.
- **Idempotent generation.** Batches are keyed by position + state; duplicate triggers return the
  in-flight batch instead of writing twice. Answering a bet never re-keys generation (that bug cost
  double model spend once — it's tested against now).
- **Immutable history.** Viewed cards never regenerate. Only unread runway is ever rewritten.

---

## The tech

| Layer | What |
|---|---|
| App | Next.js 15 App Router, TypeScript strict, React 19, Tailwind v4 |
| Motion | framer-motion 12 — opacity-only on text (a transform can overflow a card; a fade can't), velocity-aware entrances (fast flicks land on settled cards) |
| Models | Sonnet plans + themes (one call/session); Haiku writes cards, triages asks, grades answers |
| Validation | zod 4 at every model boundary — validate → trim → salvage → retry once → fallback |
| State | Supabase Postgres in prod, local JSON store in dev; fractional-indexing string keys for card order (detours splice without rewriting rows) |
| Caching | prompt-cache-stable system prompts (byte-identical across calls), frontier-keyed batch idempotency, versioned everything (schema v3, prompt versions logged per call) |
| PWA | installed standalone app: fixed shell, 100dvh, scroll-snap mandatory + snap-stop always, safe-area insets, hand-written service worker, WebKit snap-cache busting after every deck mutation |
| Testing | 800+ unit tests (vitest), ~45 Playwright e2e on WebKit at iPhone size, a worst-case deck rendering every card at schema maximums, a live-model prose test (`DRIP_LIVE_WRITE=1`) that prints real batches for human reading |
| Research | RESEARCH.md — the five sweeps (dopamine/engagement, info display, learning science, scroll UX, cold start) with citations, every applied move, and every refused anti-pattern |

## The taste rules (why it feels the way it does)

1. Never school vocabulary on screen — enforced by code and tests, not vibes.
2. Every card complete on one phone screen. Too much content → two cards.
3. Never a counter, a percentage, or a grade. Progress is geometry and flexes.
4. The feed never dead-ends and never shows a spinner mid-scroll — but it also never runs on
   without asking.
5. Motion must reveal structure or it doesn't ship. "It looks cool" is not a reason.
6. Anticipation is the engine (the research is in RESEARCH.md): the bet is the unit of engagement,
   and the payoff always lands one gesture later — never passively on the same screen.
