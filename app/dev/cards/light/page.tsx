import { Feed } from "@/components/feed/Feed";
import { devSession, sampleRows } from "@/lib/feed/dev";
import { SAMPLE_THEME_FIELD_NOTES } from "@/lib/theme/defaults";

/** Static showcase, light theme (field notes), no network. */
export default function DevCardsLightPage() {
  return <Feed session={devSession(SAMPLE_THEME_FIELD_NOTES, "life in a tide pool")} initialCards={sampleRows()} staticMode />;
}
