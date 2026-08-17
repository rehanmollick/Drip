import type { SessionPublic } from "@/lib/api/contract";
import type { Session } from "@/lib/schemas/session";

/** Session → wire shape: drop the corpus, send its size + card count. */
export function toPublic(session: Session, cardCount?: number): SessionPublic {
  const { sourceText, ...rest } = session;
  return {
    ...rest,
    sourceChars: sourceText.length,
    cardCount: cardCount ?? session.progress.totalGenerated,
  };
}
