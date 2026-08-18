import { describe, expect, it } from "vitest";
import { generateNKeysBetween } from "fractional-indexing";
import type { Slide } from "@/components/cards/types";
import type { Card } from "@/lib/schemas/cards";
import type { CardRow } from "@/lib/schemas/session";
import { buildSlides, isPseudoKey, nextPin, pseudoKindOf, runwayAhead, type Pin } from "@/lib/feed/placeholder";
import { toSlides } from "@/lib/feed/slides";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function rowAt(idx: string, n: number): CardRow {
  const payload = { id: uuid(n), type: "concept", topicNodeId: "n1", detourId: null, headline: "h", body: "b" } as Card;
  return {
    id: uuid(n),
    sessionId: uuid(999),
    idx,
    type: "concept",
    payload,
    detourId: null,
    batchId: null,
    viewedAt: null,
    interaction: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function rows(n: number): CardRow[] {
  return generateNKeysBetween(null, null, n).map((idx, i) => rowAt(idx, i + 1));
}
const keysOf = (s: Slide[]) => s.map((x) => x.key);
/** A pin holding the slot right after every one of `rowSlides` (what a tail placeholder pins). */
const pinAfterAll = (key: string, kind: Pin["kind"], rowSlides: Slide[]): Pin => ({ key, kind, above: keysOf(rowSlides) });

describe("pseudo keys", () => {
  it("recognises and decodes pseudo slide keys", () => {
    expect(isPseudoKey("pseudo:planning")).toBe(true);
    expect(isPseudoKey(uuid(1))).toBe(false);
    expect(isPseudoKey(null)).toBe(false);
    expect(pseudoKindOf("pseudo:catching_up")).toBe("catching_up");
    expect(pseudoKindOf("pseudo:nonsense")).toBeNull();
  });
});

describe("nextPin", () => {
  it("pins the head placeholder before the observer has said anything", () => {
    const slides = buildSlides({ head: "planning", rowSlides: [], tail: null, pin: null });
    const pin = nextPin(null, { activeKey: null, slides, settled: true });
    expect(pin).toEqual({ key: "pseudo:planning", kind: "planning", above: [] });
  });

  it("pins a tail placeholder to the slot it holds — every row that was above it", () => {
    const rowSlides = toSlides(rows(3));
    const slides = buildSlides({ head: null, rowSlides, tail: "catching_up", pin: null });
    const pin = nextPin(null, { activeKey: "pseudo:catching_up", slides, settled: true });
    expect(pin).toEqual({ key: "pseudo:catching_up", kind: "catching_up", above: keysOf(rowSlides) });
  });

  it("never pins a placeholder it cannot place", () => {
    // a report for a pseudo that isn't in the deck we're looking at: pinning it would have to guess
    // a slot, and guessing means dropping a tail notice at the head of the feed
    const rowSlides = toSlides(rows(3));
    const slides = buildSlides({ head: null, rowSlides, tail: null, pin: null });
    expect(nextPin(null, { activeKey: "pseudo:catching_up", slides, settled: true })).toBeNull();
  });

  it("keeps the same pin object while it stays active, and never releases mid-scroll", () => {
    const rowSlides = toSlides(rows(2));
    const slides = buildSlides({ head: null, rowSlides, tail: "catching_up", pin: null });
    const pin = nextPin(null, { activeKey: "pseudo:catching_up", slides, settled: true })!;
    expect(nextPin(pin, { activeKey: "pseudo:catching_up", slides, settled: true })).toBe(pin);
    // reader has moved onto a real card but the scroll is still running: hold the list still
    expect(nextPin(pin, { activeKey: rowSlides[0].key, slides, settled: false })).toBe(pin);
    // …and let go once it settles
    expect(nextPin(pin, { activeKey: rowSlides[0].key, slides, settled: true })).toBeNull();
  });

  it("never re-anchors a pin it already holds", () => {
    const rowSlides = toSlides(rows(4));
    const slides = buildSlides({ head: null, rowSlides: toSlides(rows(4).slice(0, 2)), tail: "catching_up", pin: null });
    const pin = nextPin(null, { activeKey: "pseudo:catching_up", slides, settled: true })!;
    expect(pin.above).toHaveLength(2);
    // a later list where the placeholder has drifted to the tail must not re-anchor it there —
    // re-anchoring is how the pin used to walk down the deck one batch at a time
    const drifted = [...rowSlides, { kind: "pseudo", key: "pseudo:catching_up", card: {} } as unknown as Slide];
    expect(nextPin(pin, { activeKey: "pseudo:catching_up", slides: drifted, settled: true })).toBe(pin);
  });
});

describe("buildSlides", () => {
  it("keeps a pinned head placeholder and appends real cards AFTER it", () => {
    const pin: Pin = { key: "pseudo:planning", kind: "planning", above: [] };
    const rowSlides = toSlides(rows(3));
    const out = buildSlides({ head: null, rowSlides, tail: null, pin });
    expect(keysOf(out)).toEqual(["pseudo:planning", ...keysOf(rowSlides)]);
  });

  it("never emits the same pseudo twice (pin absorbs an identical head or tail)", () => {
    const rowSlides = toSlides(rows(2));
    const headPin: Pin = { key: "pseudo:planning", kind: "planning", above: [] };
    expect(keysOf(buildSlides({ head: "planning", rowSlides, tail: null, pin: headPin })).filter((k) => k === "pseudo:planning")).toHaveLength(1);
    const tailPin = pinAfterAll("pseudo:catching_up", "catching_up", rowSlides);
    const out = buildSlides({ head: null, rowSlides, tail: "catching_up", pin: tailPin });
    expect(out.filter((s) => s.key === "pseudo:catching_up")).toHaveLength(1);
    expect(new Set(keysOf(out)).size).toBe(out.length);
  });

  it("holds a pinned tail in its slot: new cards land after it, not in it", () => {
    const all = rows(5);
    const first = toSlides(all.slice(0, 2));
    const pin = nextPin(null, {
      activeKey: "pseudo:catching_up",
      slides: buildSlides({ head: null, rowSlides: first, tail: "catching_up", pin: null }),
      settled: true,
    })!;
    // three more cards land while the reader stands on the placeholder
    const grown = toSlides(all);
    const out = buildSlides({ head: null, rowSlides: grown, tail: null, pin });
    expect(keysOf(out)).toEqual([...keysOf(first), "pseudo:catching_up", ...keysOf(toSlides(all.slice(2)))]);
    // the slide at the reader's index is still the same one
    expect(out[2].key).toBe("pseudo:catching_up");
  });

  it("a head notice of a different kind sits after a pinned one instead of replacing it", () => {
    const pin: Pin = { key: "pseudo:planning", kind: "planning", above: [] };
    const out = buildSlides({ head: "error", rowSlides: [], tail: null, pin });
    expect(keysOf(out)).toEqual(["pseudo:planning", "pseudo:error"]);
  });

  it("rows that vanish from the pin's slot just close up — the pin never outruns the deck", () => {
    const all = rows(4);
    const rowSlides = toSlides(all);
    const pin = pinAfterAll("pseudo:catching_up", "catching_up", rowSlides);
    const pruned = toSlides(all.slice(0, 2));
    const out = buildSlides({ head: null, rowSlides: pruned, tail: null, pin });
    expect(keysOf(out)).toEqual([...keysOf(pruned), "pseudo:catching_up"]);
  });
});

describe("runwayAhead", () => {
  it("counts what is ahead of the reader from wherever they stand", () => {
    const rowSlides = toSlides(rows(4));
    expect(runwayAhead({ rowSlides, activeKey: null, pin: null })).toBe(4);
    expect(runwayAhead({ rowSlides, activeKey: rowSlides[1].key, pin: null })).toBe(2);
    expect(runwayAhead({ rowSlides, activeKey: "pseudo:planning", pin: null })).toBe(4);
    expect(runwayAhead({ rowSlides, activeKey: "pseudo:catching_up", pin: null })).toBe(0);
    // pinned to the head → everything that landed is ahead of them; pinned mid-deck → only the tail
    expect(runwayAhead({ rowSlides, activeKey: "pseudo:planning", pin: { key: "pseudo:planning", kind: "planning", above: [] } })).toBe(4);
    expect(
      runwayAhead({ rowSlides, activeKey: "pseudo:catching_up", pin: pinAfterAll("pseudo:catching_up", "catching_up", rowSlides.slice(0, 2)) }),
    ).toBe(2);
    expect(runwayAhead({ rowSlides, activeKey: "gone", pin: null })).toBeNull();
  });
});

describe("regression: the card under the thumb never changes identity (bug 5)", () => {
  it("planning → active with cards landing keeps the reader's slide key AND index", () => {
    // t=0: session is planning, nothing written yet, the reader is on the only slide there is
    let pin = nextPin(null, { activeKey: null, slides: buildSlides({ head: "planning", rowSlides: [], tail: null, pin: null }), settled: true });
    let slides = buildSlides({ head: "planning", rowSlides: [], tail: null, pin });
    const at = 0;
    const before = slides[at].key;
    expect(before).toBe("pseudo:planning");

    // t=15s: status flips to active before the client has the cards. Old behaviour swapped in
    // `pseudo:catching_up`; the head placeholder must survive untouched.
    pin = nextPin(pin, { activeKey: "pseudo:planning", slides, settled: true });
    slides = buildSlides({ head: "planning", rowSlides: [], tail: null, pin });
    expect(slides[at].key).toBe(before);

    // t=20s: the real batch lands. It goes AFTER the placeholder, never into its slot.
    const rowSlides = toSlides(rows(6));
    pin = nextPin(pin, { activeKey: "pseudo:planning", slides, settled: true });
    slides = buildSlides({ head: null, rowSlides, tail: null, pin });
    expect(slides[at].key).toBe(before);
    expect(slides[1].key).toBe(rowSlides[0].key);

    // and once they swipe off it (and the scroll settles) it is dropped
    pin = nextPin(pin, { activeKey: rowSlides[0].key, slides, settled: true });
    slides = buildSlides({ head: null, rowSlides, tail: null, pin });
    expect(slides.some((s) => isPseudoKey(s.key))).toBe(false);
  });

  it("an ambiguous active report is not a move — the pin holds through it", () => {
    const rowSlides = toSlides(rows(3));
    const slides = buildSlides({ head: null, rowSlides, tail: "catching_up", pin: null });
    const pin = nextPin(null, { activeKey: "pseudo:catching_up", slides, settled: true })!;

    // the observer fired from a layout that has already been replaced, so it names a slide that
    // isn't in the deck we're looking at. Treating that as "they moved" drops the pin while the
    // reader is still standing on the placeholder.
    expect(nextPin(pin, { activeKey: uuid(404), slides, settled: true })).toBe(pin);
    // "no idea where they are" is not a move either
    expect(nextPin(pin, { activeKey: null, slides: [], settled: true })).toBe(pin);
    // …and neither is a move that hasn't come to rest
    expect(nextPin(pin, { activeKey: rowSlides[2].key, slides, settled: false })).toBe(pin);
    // only a settled move onto a slide that is really there releases it
    expect(nextPin(pin, { activeKey: rowSlides[2].key, slides, settled: true })).toBeNull();
  });

  it("a batch that sorts ABOVE the placeholder still lands after it", () => {
    // The root cause, on its own: the batch carries idx keys generated against a stale frontier, so
    // by idx it belongs in the middle of the deck. Sorting it into place walks the placeholder down
    // the deck — same key, different slot — and strands the new cards above the reader.
    const deck = rows(8);
    const rowSlides = toSlides(deck);
    const pin = nextPin(null, {
      activeKey: "pseudo:catching_up",
      slides: buildSlides({ head: null, rowSlides, tail: "catching_up", pin: null }),
      settled: true,
    })!;
    const landed = [rowAt(`${deck[2].idx}V`, 101), rowAt(`${deck[2].idx}VV`, 102)];
    const grown = toSlides([...deck, ...landed]);
    expect(keysOf(grown).slice(2, 5), "by idx alone these belong mid-deck").toEqual([deck[2].id, landed[0].id, landed[1].id]);

    const out = buildSlides({ head: null, rowSlides: grown, tail: null, pin });
    expect(out.indexOf(out.find((s) => s.key === "pseudo:catching_up")!)).toBe(8);
    expect(keysOf(out).slice(9)).toEqual([landed[0].id, landed[1].id]);
    expect(runwayAhead({ rowSlides: grown, activeKey: "pseudo:catching_up", pin })).toBe(2);
  });

  it("the browser sequence that broke: pinned tail → ambiguous report → an out-of-order batch lands", () => {
    // 8 cards written, the reader has walked to the end and is standing on "catching up…"
    const deck = rows(8);
    const rowSlides = toSlides(deck);
    let slides = buildSlides({ head: null, rowSlides, tail: "catching_up", pin: null });
    let pin = nextPin(null, { activeKey: "pseudo:catching_up", slides, settled: true });
    slides = buildSlides({ head: null, rowSlides, tail: "catching_up", pin });
    const before = { key: slides[8].key, index: 8, below: slides.length - 1 - 8 };
    expect(before.key).toBe("pseudo:catching_up");
    expect(before.below).toBe(0);

    // the observer reports a slide the current deck doesn't contain (it fired from the list as it
    // was one commit ago). The reader has not moved.
    pin = nextPin(pin, { activeKey: uuid(404), slides, settled: true });

    // …and the batch lands carrying idx keys generated from a stale frontier, so by idx alone the
    // two new rows belong near the TOP of the deck, not at the end.
    const landed = [rowAt(`${deck[0].idx}V`, 101), rowAt(`${deck[0].idx}W`, 102)];
    const grown = toSlides([...deck, ...landed]);
    expect(keysOf(grown).slice(0, 3)).toEqual([deck[0].id, landed[0].id, landed[1].id]);

    const runway = runwayAhead({ rowSlides: grown, activeKey: "pseudo:catching_up", pin });
    expect(runway, "the feed must see the new cards as runway ahead of the reader").toBe(2);
    const tail = runway === 0 ? "catching_up" : null;
    const after = buildSlides({ head: null, rowSlides: grown, tail, pin });
    const index = after.findIndex((s) => s.key === "pseudo:catching_up");

    expect(after[index].key, "the card under the thumb changed identity").toBe(before.key);
    expect(index, "the card under the thumb moved slot").toBe(before.index);
    expect(after.length - 1 - index, "new cards must land AFTER the placeholder").toBeGreaterThan(0);
    expect(keysOf(after).slice(index + 1)).toEqual([landed[0].id, landed[1].id]);
  });
});
