import { redirect } from "next/navigation";
import { Feed } from "@/components/feed/Feed";
import { getStore } from "@/lib/db";
import { toSessionPublic } from "@/lib/feed/session";
import type { CardRow, Session } from "@/lib/schemas/session";

export const dynamic = "force-dynamic";

const INITIAL_CARDS = 24;

/** Supabase cold start (spec §12.8): one retry after 3s behind the splash (loading.tsx). */
async function load(id: string): Promise<{ session: Session; cards: CardRow[] } | null> {
  const attempt = async () => {
    const store = await getStore();
    const session = await store.getSession(id);
    if (!session) return null;
    const cards = await store.listAllCards(id);
    return { session, cards };
  };
  try {
    return await attempt();
  } catch (first) {
    await new Promise((r) => setTimeout(r, 3_000));
    try {
      return await attempt();
    } catch {
      console.error("[feed] store unreachable", first);
      return null;
    }
  }
}

export default async function FeedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await load(id);
  if (!loaded) redirect("/");
  const { session, cards } = loaded;
  // enough to resume where they left off + a runway, without shipping a 300-card session up front
  const initialCards = cards.slice(0, Math.max(INITIAL_CARDS, session.position + 12));
  return <Feed session={toSessionPublic(session, cards.length)} initialCards={initialCards} />;
}
