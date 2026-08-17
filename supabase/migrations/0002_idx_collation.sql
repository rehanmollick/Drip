-- DRIP — force byte-order collation on fractional-indexing keys.
--
-- Projects created from the ORIGINAL 0001_init.sql got cards.idx /
-- detours.inserted_after_idx under the database default collation
-- (en_US.UTF-8 on Supabase). fractional-indexing keys need byte order
-- (0-9 < A-Z < a-z; JS `<`), otherwise ORDER BY idx and idx > $1 disagree with
-- the app: 'aa' sorts before 'aA', 'Zz' after 'a0', lastCard returns the wrong
-- row after ~37 cards and generation dead-ends on duplicate keys.
--
-- Safe to run on a fresh project too (0001 now declares collate "C"; altering
-- to the same collation is a no-op rewrite). Rebuilds the dependent indexes.

alter table cards   alter column idx                type text collate "C";
alter table detours alter column inserted_after_idx type text collate "C";

-- The unique constraint already provides the (session_id, idx) index.
drop index if exists cards_session_idx_idx;
