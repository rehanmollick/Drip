import { Feed } from "@/components/feed/Feed";
import { devSession, sampleRows } from "@/lib/feed/dev";
import { SAMPLE_THEME_TERMINAL_NOIR } from "@/lib/theme/defaults";

/** Static showcase: every sample card, terminal-noir theme, no network. Playwright screenshots this. */
export default function DevCardsPage() {
  return <Feed session={devSession(SAMPLE_THEME_TERMINAL_NOIR)} initialCards={sampleRows()} staticMode />;
}
