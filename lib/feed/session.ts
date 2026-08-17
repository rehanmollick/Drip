import type { SessionPublic } from "@/lib/api/contract";
import type { Session } from "@/lib/schemas/session";

/** Session → SessionPublic: drop the corpus, keep its size + the card count. */
export function toSessionPublic(session: Session, cardCount: number): SessionPublic {
  const { sourceText, ...rest } = session;
  return { ...rest, sourceChars: sourceText?.length ?? 0, cardCount };
}
