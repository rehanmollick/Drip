import { Feed } from "@/components/feed/Feed";
import { devSession, sampleRows } from "@/lib/feed/dev";
import type { Card } from "@/lib/schemas/cards";
import { SAMPLE_THEME_TERMINAL_NOIR } from "@/lib/theme/defaults";

/**
 * Timeline + session map fixture (no network): the showcase deck spread across the whole outline,
 * so the bar shows real topic transitions and the map has topics behind you, one you're in, and
 * ones still ahead. e2e/timeline.spec.ts drives this page.
 */
export default function DevTimelinePage() {
  const session = devSession(SAMPLE_THEME_TERMINAL_NOIR, "how a cache keeps a site alive");
  const nodes = session.outline.map((n) => n.id);
  const rows = sampleRows();
  const per = Math.ceil(rows.length / nodes.length);
  const spread = rows.map((r, i) => {
    const topicNodeId = nodes[Math.min(nodes.length - 1, Math.floor(i / per))];
    return {
      ...r,
      payload: { ...(r.payload as Card), topicNodeId } as Card,
      // everything up to the halfway mark reads as already been through
      viewedAt: i < per * 2 ? "2026-01-01T00:00:00.000Z" : null,
    };
  });
  return <Feed session={{ ...session, position: per * 2 }} initialCards={spread} staticMode />;
}
