import type { FrontierPublic, SessionPublic } from "@/lib/api/contract";
import type { Session } from "@/lib/schemas/session";

/** Session → wire shape: drop the corpus, send its size + card count. */
export function toPublic(session: Session, cardCount?: number, frontier?: FrontierPublic | null): SessionPublic {
  const { sourceText, ...rest } = session;
  return {
    ...rest,
    sourceChars: sourceText.length,
    cardCount: cardCount ?? session.progress.totalGenerated,
    // absent when nobody counted it: "we didn't look" and "nothing is happening" are different answers
    ...(frontier === undefined ? {} : { frontier }),
  };
}
