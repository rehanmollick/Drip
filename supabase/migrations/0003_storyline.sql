-- DRIP — the storyline column (the through-line carried across writer calls) and the
-- generation gate. Safe to run more than once.
--
-- storyline: {spine, covered[], next, updatedAtIdx} — what the session is about, what has
-- landed, where it is heading. Without it a card 40 slides deep only knows the last 6 cards.
-- The generation gate (progress.awaitingChoice / deeperCards) lives inside the existing
-- progress jsonb, so it needs no column of its own.

alter table sessions add column if not exists storyline jsonb;
