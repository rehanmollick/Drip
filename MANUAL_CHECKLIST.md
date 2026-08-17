# MANUAL_CHECKLIST.md — real-device checks (run on an iPhone, FROM THE INSTALLED HOME-SCREEN ICON)

Everything below can only be verified on real hardware in standalone PWA mode. Playwright (iPhone viewport, headless Chromium) covers the non-feel parts automatically — see BUILD_LOG.md.

Setup: push a branch → Vercel preview URL (HTTPS is required for the service worker + installability) → open on the phone → Share → Add to Home Screen → launch from the icon.

- [ ] Hard-flick scrolls exactly one card, every time, no half-states (`scroll-snap-stop: always`) — in standalone mode, not just the Safari tab
- [ ] No rubber-banding into browser chrome at the top/bottom of the feed (`overscroll-behavior-y: contain`, fixed app shell)
- [ ] Add to Home Screen → launches standalone, no Safari chrome, splash themed dark
- [ ] Airplane mode mid-feed: viewed cards readable, one graceful "back online soon" frontier card, recovers on reconnect
- [ ] Lock the phone for 5 minutes mid-card → recorded dwell ≤ 60s (check `cards.interaction.dwellMs`), no recap spam on return
- [ ] Long-press the 2px progress hairline → refresh works (pull-to-refresh doesn't exist standalone)
- [ ] Sequence cards: drag-reorder chips with a thumb feels right (no accidental page scroll)
- [ ] Slider cards: thumb is grabbable, output updates live, no page scroll while dragging
- [ ] Tap feedback: buttons scale to 0.97 with a spring; correct → local confetti (never full-screen); wrong → shake ±6px ×3
- [ ] Ask bar + back chevron fade out while scrolling and reappear ~400ms after rest
- [ ] Fonts: no flash of unstyled text on session open (self-hosted next/font)
- [ ] Sound ticks (settings → sound on): audible but very quiet; nothing plays until first tap
- [ ] Reduced motion (Settings → Accessibility → Motion → Reduce Motion): no springs, content still staggers as fades
- [ ] Paste the full Freshet doc: plan lands, theme is subject-derived, spot-check 30 cards for zero fabricated facts against the doc
- [ ] YouTube URL with captions → session builds; URL without captions → clear in-sheet error, no hang
- [ ] New session shows its first card after exactly one wait (plan), never a second wait for the first batch
- [ ] Kill the API key in Vercel env → feed degrades to the fallback card, app does not crash
- [ ] Spam-scroll to the frontier repeatedly → no duplicate cards ever (check `cards` table for duplicate payload ids)
