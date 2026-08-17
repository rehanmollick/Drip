import { Feed } from "@/components/feed/Feed";
import { devSession } from "@/lib/feed/dev";
import { worstRows } from "@/lib/feed/worst";
import { SAMPLE_THEME_TERMINAL_NOIR } from "@/lib/theme/defaults";

/** Fit ruler: every card type at schema-max copy, terminal-noir theme, no network. e2e/fit.spec.ts measures it. */
export default function DevCardsWorstPage() {
  return <Feed session={devSession(SAMPLE_THEME_TERMINAL_NOIR, "worst case: every string at its cap")} initialCards={worstRows()} staticMode />;
}
