import { Feed } from "@/components/feed/Feed";
import type { FrontierPublic, SessionPublic } from "@/lib/api/contract";
import { devSession, sampleRows } from "@/lib/feed/dev";
import type { Card } from "@/lib/schemas/cards";
import type { CardRow } from "@/lib/schemas/session";
import { SAMPLE_THEME_TERMINAL_NOIR } from "@/lib/theme/defaults";

/**
 * Timeline + session map fixture (no network). e2e/timeline.spec.ts drives this page.
 *
 * Default: the showcase deck spread across the whole outline, with NO frontier — the bar says only
 * what the local rows can prove, exactly as it did before anything counted.
 *
 * `?state=buffered|live|gate` bolts on a counted frontier so the three things the bar exists to
 * tell apart are screenshot-testable:
 *   buffered  a finished topic, one you're inside with runway ahead, one written but unreached,
 *             and one that is nothing but a heading so far
 *   live      the same, plus a batch being written into the topic ahead — one pulsing nib
 *   gate      the same, parked at a fork: no nib anywhere (nothing is being written while it waits)
 *             and everything downstream of the fork dimmed
 */

const SEEN = "2026-01-01T00:00:00.000Z";
const FIXTURES = ["buffered", "live", "gate"] as const;
type Fixture = (typeof FIXTURES)[number];

export default async function DevTimelinePage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  const session = devSession(SAMPLE_THEME_TERMINAL_NOIR, "how a cache keeps a site alive");
  const rows = sampleRows();
  const fixture = FIXTURES.find((f) => f === state);
  const { session: s, cards } = fixture ? counted(session, rows, fixture) : spreadOverOutline(session, rows);
  return <Feed session={s} initialCards={cards} staticMode />;
}

/** The default fixture: every topic carries some of the deck, so the bar shows real transitions. */
function spreadOverOutline(session: SessionPublic, rows: CardRow[]) {
  const nodes = session.outline.map((n) => n.id);
  const per = Math.ceil(rows.length / nodes.length);
  const cards = rows.map((r, i) => ({
    ...r,
    payload: { ...(r.payload as Card), topicNodeId: nodes[Math.min(nodes.length - 1, Math.floor(i / per))] } as Card,
    // everything up to the halfway mark reads as already been through
    viewedAt: i < per * 2 ? SEEN : null,
  }));
  return { session: { ...session, position: per * 2 }, cards };
}

/**
 * The counted fixtures. The whole deck sits in the first two topics — one finished behind the
 * reader, one they're standing in — which is what a real session looks like: you cannot hold rows
 * for a topic the writer hasn't reached. Everything the bar knows about the two topics ahead comes
 * from the census, which is the entire point.
 */
function counted(session: SessionPublic, rows: CardRow[], fixture: Fixture) {
  const half = Math.floor(rows.length / 2);
  const crossroads = rows.findIndex((r, i) => i >= half && (r.payload as Card).type === "crossroads");
  const at = fixture === "gate" && crossroads >= 0 ? crossroads : half + Math.floor(half * 0.6);
  const cards = rows.map((r, i) => ({
    ...r,
    payload: { ...(r.payload as Card), topicNodeId: i < half ? "n0" : "n1" } as Card,
    viewedAt: i <= at ? SEEN : null,
  }));

  const frontier: FrontierPublic = {
    // n0 is finished, n1 is what the writer is in, n2 has a stretch written but unreached, and n3
    // is absent from the census entirely — nothing but a heading, which is how an unwritten node
    // arrives. the four things the bar has to be able to draw differently
    written: { n0: half, n1: rows.length - half, n2: 4 },
    nodeIdx: 1,
    deeper: {},
    closed: ["n0"],
    gate: fixture === "gate" ? "crossroads" : null,
    // set on the gate fixture too: a fork claims no batch, so the nib must vanish anyway
    live: fixture === "buffered" ? null : { nodeIdx: 2, startedAt: SEEN },
    epoch: 0,
  };
  return { session: { ...session, position: at, frontier }, cards };
}
