import type { FrontierPublic } from "@/lib/api/contract";
import type { OutlineNode } from "@/lib/schemas/plan";
import { WRITER_CARD_TYPES } from "@/lib/schemas/cards";
import type { CardRow, Session } from "@/lib/schemas/session";

/**
 * Where generation actually is — counted, never guessed.
 *
 * The client used to know nothing: batch status lived in the engine and died there, so anything
 * drawing a position had to infer it from `estCards`, which the writer routinely overshoots and
 * undershoots. Everything here is counted from rows that EXIST, so the only way to be wrong is for
 * the feed itself to be wrong.
 *
 * This file also owns the primitives the counting is defined in (`COUNTS_TOWARD_NODE`,
 * `DEEPER_CARDS`) rather than borrowing them from the engine: the engine imports them from here and
 * never the other way round, so "what counts as progress" has exactly one home and the two files
 * cannot drift into a cycle.
 *
 * Pure on purpose: one session object plus its card rows in, the wire shape out. The store lives on
 * the other side of `frontierOf` in the engine.
 */

/** Extra cards granted by "one more layer here" at a crossroads (4 on the deep preset). */
export const DEEPER_CARDS = 3;
export const DEEPER_CARDS_DEEP = 4;

/** Types that count toward a node's card budget. Recaps, crossroads, wraps and every system card do not. */
export const COUNTS_TOWARD_NODE: ReadonlySet<string> = new Set(WRITER_CARD_TYPES.filter((t) => t !== "recap"));
// the payload is the source of truth for a row's shape (the `type` column mirrors it)
export const countsTowardNode = (c: CardRow) => !c.detourId && COUNTS_TOWARD_NODE.has(c.payload.type);

/**
 * How many cards each node actually got. Detour rows are somebody's question, not the thread, and
 * the non-teaching types (recap, crossroads, wrap, notice, clarify, fallback, detour markers) are
 * scaffolding around the thread — none of them are progress through the outline, so none of them
 * count. Same predicate the engine budgets nodes with, so a census can never disagree with the
 * writer about where it is.
 *
 * Only nodes that HAVE cards appear: a missing node means zero, which every reader of this already
 * assumes. A 24-node outline mostly hasn't been written yet, and shipping twenty zeros on every
 * session response is twenty keys of nothing on the hottest path there is.
 */
export function nodeCensus(cards: CardRow[], outline: OutlineNode[]): Record<string, number> {
  const written: Record<string, number> = {};
  const ids = new Set(outline.map((n) => n.id));
  for (const c of cards) {
    if (!countsTowardNode(c)) continue;
    const id = c.payload.topicNodeId;
    if (ids.has(id)) written[id] = (written[id] ?? 0) + 1;
  }
  return written;
}

/**
 * The nodes the writer has finished, in the order it finished them. A node closes when it carries a
 * crossroads row: the batch that ended the topic built one, whatever `estCards` guessed, and that
 * is the only honest signal of completion there is.
 */
export function closedNodes(cards: CardRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of cards) {
    if (c.detourId || c.payload.type !== "crossroads") continue;
    if (seen.has(c.payload.topicNodeId)) continue;
    seen.add(c.payload.topicNodeId);
    out.push(c.payload.topicNodeId);
  }
  return out;
}

/** node id → extra cards a "one more layer here" tap bought there. */
export function deeperGrants(cards: CardRow[], depthPreset: Session["settings"]["depthPreset"]): Record<string, number> {
  const grant = depthPreset === "deep" ? DEEPER_CARDS_DEEP : DEEPER_CARDS;
  const out: Record<string, number> = {};
  for (const c of cards) {
    if (c.detourId || c.payload.type !== "crossroads" || c.interaction?.choice !== "deeper") continue;
    out[c.payload.topicNodeId] = (out[c.payload.topicNodeId] ?? 0) + grant;
  }
  return out;
}

/**
 * What generation is parked on, mirroring the engine's own short-circuits: a wrap ends the thread
 * for good, and an unanswered crossroads holds it until the reader picks. Null means nothing is in
 * the way — anything still missing is coming.
 */
export function gateOf(session: Pick<Session, "progress">, cards: CardRow[]): FrontierPublic["gate"] {
  if (cards.some((c) => c.payload.type === "wrap")) return "wrap";
  if (!session.progress.awaitingChoice) return null;
  return cards.some((c) => c.payload.type === "crossroads" && c.interaction?.choice === undefined) ? "crossroads" : null;
}

/**
 * The wire shape. `live` comes from the engine — only it can see whether a batch is in flight — and
 * everything else is counted here.
 */
export function frontierPublic(
  session: Session,
  cards: CardRow[],
  live: FrontierPublic["live"] = null,
): FrontierPublic {
  return {
    written: nodeCensus(cards, session.outline),
    nodeIdx: session.progress.nodeIdx,
    deeper: deeperGrants(cards, session.settings.depthPreset),
    closed: closedNodes(cards),
    gate: gateOf(session, cards),
    live,
    epoch: session.progress.epoch,
  };
}
