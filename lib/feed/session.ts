import type { SessionPublic } from "@/lib/api/contract";
import { frontierPublic } from "@/lib/generation/frontier";
import type { CardRow, Session } from "@/lib/schemas/session";

/**
 * Session → SessionPublic for the first paint: drop the corpus, keep its size, the card count, and
 * the frontier.
 *
 * The frontier is counted here rather than left out. The page ships only the first ~24 rows, so a
 * bar drawn from local rows alone would under-report a 300-card session on the one render the
 * reader sees before anything else has loaded — the mirror would be reporting less than the page
 * already knows. `frontierPublic` is pure and counts the rows this page has already read, so
 * telling the truth costs nothing.
 *
 * `live` is the one field a pure count cannot answer (it takes a batch read), and null here is not
 * a claim that nothing is being written: the feed lights the nib off its own pump the instant one
 * leaves the device, which is sooner than a read here could have told it anyway.
 */
export function toSessionPublic(session: Session, cards: CardRow[]): SessionPublic {
  const { sourceText, ...rest } = session;
  return {
    ...rest,
    sourceChars: sourceText?.length ?? 0,
    cardCount: cards.length,
    frontier: frontierPublic(session, cards, null),
  };
}
