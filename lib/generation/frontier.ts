import type { FrontierPublic } from "@/lib/api/contract";
import type { OutlineNode } from "@/lib/schemas/plan";
import type { CardRow, Session } from "@/lib/schemas/session";
import { nowIso } from "@/lib/id";
import { DEEPER_CARDS, DEEPER_CARDS_DEEP, countsTowardNode, sameUtcDay } from "./engine";
import { isBudgetNotice } from "./system-cards";

/**
 * Where generation actually is — counted, never guessed.
 *
 * The client used to know nothing: batch status lived in the engine and died there, so anything
 * drawing a position had to infer it from `estCards`, which the writer routinely overshoots and
 * undershoots. Everything here is counted from rows that EXIST, so the only way to be wrong is for
 * the feed itself to be wrong.
 *
 * Pure on purpose: one session object plus its card rows in, the wire shape out. The store lives on
 * the other side of `frontierOf` in the engine.
 */

export type NodeCensus = {
  /** outline node id → main-thread teaching cards that exist for it (every node, zeros included). */
  written: Record<string, number>;
  /** teaching cards that belong to no outline node: teasers, the adjacent/near-miss stretch past the end. */
  beyond: number;
};

/**
 * How many cards a node actually got. Detour rows are somebody's question, not the thread, and the
 * non-teaching types (recap, crossroads, wrap, notice, clarify, fallback, detour markers) are
 * scaffolding around the thread — none of them are progress through the outline, so none of them
 * count. Same predicate the engine budgets nodes with, so a census can never disagree with the
 * writer about where it is.
 */
export function nodeCensus(cards: CardRow[], outline: OutlineNode[]): NodeCensus {
  const written: Record<string, number> = Object.fromEntries(outline.map((n) => [n.id, 0]));
  const ids = new Set(outline.map((n) => n.id));
  let beyond = 0;
  for (const c of cards) {
    if (!countsTowardNode(c)) continue;
    if (ids.has(c.payload.topicNodeId)) written[c.payload.topicNodeId] += 1;
    else beyond += 1;
  }
  return { written, beyond };
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

/** Stopped by something scrolling can't clear: today's spend cap, or a session that died planning. */
function isHalted(session: Pick<Session, "status">, cards: CardRow[], now: string): boolean {
  if (session.status === "error") return true;
  const last = cards[cards.length - 1];
  return !!last && isBudgetNotice(last.payload) && sameUtcDay(last.createdAt, now);
}

/**
 * The wire shape. `live` comes from the engine — only it can see whether a batch is in flight — and
 * everything else is counted here.
 */
export function frontierPublic(
  session: Session,
  cards: CardRow[],
  live: FrontierPublic["live"] = null,
  now: string = nowIso(),
): FrontierPublic {
  const census = nodeCensus(cards, session.outline);
  return {
    written: census.written,
    beyond: census.beyond,
    nodeIdx: session.progress.nodeIdx,
    deeper: deeperGrants(cards, session.settings.depthPreset),
    closed: closedNodes(cards),
    gate: gateOf(session, cards),
    live,
    epoch: session.progress.epoch,
    halted: isHalted(session, cards, now),
  };
}
