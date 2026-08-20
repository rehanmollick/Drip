# HANDOFF.md — start here

`CLAUDE.md` is the working contract. `BUILD_LOG.md` is what happened and why. `dripSpec.md` is the
original design and is now **pre-v3** — it has no mention of crossroads, scrub, spot, stat, open,
`terms` or `anchor`. Trust `lib/schemas/*.ts` over any prose in this repo, including this file.

This file exists for the one category of thing the code cannot tell you: **what was deliberately not
built, and what is still unverified.**

## Where it stands

v3 is live at drip-beta-sooty.vercel.app (passphrase gate, auto-deploys from `main`, installed as a
PWA on the owner's phone — a push to `main` updates the app in his pocket). All migrations applied.
772 unit tests, 36 e2e, clean build. `CARD_SCHEMA_VERSION` 3, `LEARNER_STATE_VERSION` 2.

## The two things a human still has to judge

Neither can be settled by a test. Do not let a green suite convince you otherwise.

1. **Callback density has never been seen live.** The spaced-retrieval layer is wired and gated
   (`lib/adapt/schedule.ts`), but `lib/llm-mock.ts` ignores the `due` directive, so no e2e or mock
   run exercises it. The budget errs conservative — one idea per batch max, nothing before ordinal
   12, gaps of 10 and 26, retire after 2 wins, off entirely in chill mode and while compressing.
   **The failure mode is that the feed starts to feel like it is checking up on you.** That is the
   single most likely way this app tips back into feeling like school, and it needs a real session
   read on a phone, not a screenshot.
2. **Composition.** Cards are top-anchored and the bottom 30–40% is empty above the ask bar.
   Consistent and deliberate, but it reads airier and more presentational than a dense feed. Needs
   an eye on real hardware.

## Only one check tells you if the writing is good

Everything else in this repo runs against canned mock output.

```
DRIP_LIVE_WRITE=1 pnpm exec vitest run tests/write.live.test.ts --disable-console-intercept
```

The flag matters — vitest swallows stdout for passing tests, and reading the prose is the entire
point. Three real batches across three subject families, ~$0.02. Baseline and post-change results
are both in `BUILD_LOG.md`; beat them, don't just pass them.

## Do not rebuild these

Each was designed in full, then cut for a reason that still holds. If you find yourself proposing
one, the reason is here — argue with it before you build it.

| Cut | Why |
|---|---|
| `tradeoff` card type | A prompt + dial + two labelled meters + two odometers cannot fit 393×852 without scrolling, and ~90% of its schema is `slider` already. |
| `sort` card type | A matching exercise: assign chips to bins, get marked. The most course-shaped mechanic anyone proposed. Its drag also fights `scroll-snap-type: y mandatory`. |
| **pre-test cards** | A card the reader is *meant* to get wrong before anything is explained. Genuinely research-backed, and named after the thing the Prime Directive forbids. A feed does not open a topic by testing you on it. |
| Weighted timeline segment widths | A 3-card topic goes sub-pixel next to a 12-card one on a 393px bar, and they re-flex mid-session on every replan. Equal widths already say "these are the topics, in order". |
| Trailing "open water" timeline segment | No label and no meaning — and the moment you label it, the bar has text on it, which the copy rules forbid forever. |
| Four-state map legend | Four unlabelled dot treatments is a legend nobody was taught, and the words that would explain it are banned. Reduced to written/planned. |
| 3 of 4 prose-quality metrics (`nominalDensity`, `echoesHeadline`, `specificRatio`) | Only unintroduced-jargon has ground truth (the corpus + the glossary ledger). The others are heuristics with an unmeasurable false-positive rate, and every false positive pushes the writer toward over-glossing. |
| Mandatory `eyebrow` validation gate | Forcing a stance field under threat of rejection turns a voice slot into a filled slot — "the thing" and "the trade" on every third card. Kept as a prompt rule. The `LABEL_EYEBROW` *rejection* stays. |
| `persona.openers` | Two more strings for Sonnet to invent, doing worse what `sampleCard` already does — one full card written in voice about the actual subject. |
| Headline chunking / `pop` scale-rotate | A hook exists to land one claim; delivering it in three beats delays the only thing it does, and a fast scroller passes it mid-assembly. `pop` is motion carrying no meaning — the failure mode, not the fix. |
| Sequence staged-correction trail, diagram "breathe" | ~1s of animation during the moment the reader is trying to read a correction. A box that breathes forever is wallpaper. |
| Third spacing tier (64 cards), anchor retirement, `fluencyGap` | Untestable in a session that runs 40–120 cards with ~25% scored. |
| `latencyMs` on interactions | Free to collect and read by nothing. That is how schemas rot; add it when something consumes it. |

## Things that will bite you

- **`learnerStateHash` is a closed whitelist and must stay one.** It feeds the generation frontier
  key. Anything volatile in it re-keys the frontier, and the in-flight batch plus the next request
  claim two different keys for the same slot — the model gets paid twice. This bug shipped once.
- **The >25s dwell recap trigger is deliberate.** It was deleted once on the reasoning that a long
  dwell is "as likely a doorbell as confusion". That is wrong: `lib/dwell.ts` already pauses on
  `visibilitychange`/`pagehide` and caps at 60s, so what reaches the reducer is *active foreground*
  reading. `dripSpec.md` §271 asks for it by name.
- **The prompt cache is knowingly imperfect.** `buildWriteSystem` is byte-stable across
  mode/recent/batchSize but **not** across `allowedTypes`, which the variety governor narrows per
  batch — so a session ping-pongs between up to four ~10k-token system prompts. The trade: a
  narrowed schema means the writer *cannot* emit a `concept`, where a prompt-level ban is a nudge
  that costs a retry when ignored. Do not "fix" this without re-deciding that trade.
- **The mock personas have no `analogyWorld`/`sampleCard`**, so nothing in the Playwright suite
  exercises the demonstration half of `personaBlock`. Adding them to `lib/llm-mock.ts` would put it
  under test.
- **`lib/prompts/detour.ts` shares the writer system prompt** (a pinned invariant — see
  `tests/prompts.test.ts`), so it inherits all the craft rules, but its user turn has no
  `dueBlock`/`glossaryBlock`. A detour is exactly where a term gets glossed twice.
- **Screenshot anything visual before believing it.** Agents reported the new cards fit at 393×852.
  They did not — `spot` overflowed by 27px at schema maximum. `/dev/cards/worst` renders every card
  at its schema limits; that page exists for this.
