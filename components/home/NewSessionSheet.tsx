"use client";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiClientError } from "@/lib/api/client";
import type { CreateSessionBody, IngestData, SessionPublic } from "@/lib/api/contract";
import { clampTitle, INPUT_MAX, ingestPath, isRepoUrl, isYoutubeUrl, loneUrl, routeInput } from "@/lib/feed/input";
import type { DepthPreset } from "@/lib/schemas/learner";
import { useTheme } from "@/components/theme/ThemeRoot";
import { BottomSheet, Segmented, Toggle } from "./BottomSheet";
import { daySeed, suggestionsAt } from "./suggestions";

const DEPTHS: { value: DepthPreset; label: string }[] = [
  { value: "skim", label: "skim" },
  { value: "standard", label: "standard" },
  { value: "deep", label: "deep" },
];

/** one quiet line per depth, same voice as the chill sub-line — what the ride feels like, never a count */
export const DEPTH_LINES: Record<DepthPreset, string> = {
  skim: "the fast pass — big ideas, no digressions",
  standard: "the full ride — ideas, bets, and the occasional detour",
  deep: "everything, plus the layer under it — longer stay per topic",
};

/** an accidental dismiss must never eat a pasted wall of text */
export const DRAFT_KEY = "drip:newSessionDraft";

function saveDraft(text: string) {
  try {
    if (text.trim()) localStorage.setItem(DRAFT_KEY, text.slice(0, INPUT_MAX));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // storage full or blocked — the draft is a courtesy, never an error
  }
}
function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * NEW SESSION (spec §2): one big textarea (sentence / wall of text / URL),
 * suggested starts that teach by example, drop-a-file, chill + depth toggles,
 * "drip it". URL inputs go through /api/ingest/* first; ingest errors show
 * in-sheet (never a hang). Then POST /api/sessions and navigate straight to
 * the feed — it handles planning.
 */
/** In-sheet error copy: ingest routes author lowercase sheet-voice messages (a dead link, a slow page,
 *  no captions…) at any status — show those; only truly generic failures get the generic line. */
const GENERIC = "that didn't go through. try again?";
const OPAQUE_CODES = new Set(["internal", "bad_response", "http_error", "unknown"]);
export function sheetError(e: unknown): string {
  if (!(e instanceof ApiClientError)) return typeof navigator !== "undefined" && navigator.onLine === false ? "you're offline. the sheet needs a signal." : GENERIC;
  if (e.code === "invalid_request") return "that's a lot of text — keep it under 400k characters.";
  if (OPAQUE_CODES.has(e.code) || !e.message) return GENERIC;
  return e.message.toLowerCase();
}

/** what the unfurl row promises for a detected link */
export function unfurlLine(url: string): string {
  if (isYoutubeUrl(url)) return "we'll pull the captions";
  if (isRepoUrl(url)) return "we'll read the repo";
  return "we'll read the page";
}

export function urlDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

export function NewSessionSheet({ open, onClose, seed }: { open: boolean; onClose: () => void; seed?: string | null }) {
  const router = useRouter();
  const { spring, reduced } = useTheme();
  const [text, setText] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [chill, setChill] = useState(false);
  const [depth, setDepth] = useState<DepthPreset>("standard");
  const [busy, setBusy] = useState<null | "reading" | "brewing">(null);
  const [nudge, setNudge] = useState<string | null>(null);
  const [rot, setRot] = useState(() => daySeed());
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    if (open) {
      setNudge(null);
      setRot((r) => r + 1); // fresh examples each time the sheet comes up
      // a tapped example wins; otherwise an interrupted draft comes back
      if (seed) setText(seed.slice(0, INPUT_MAX));
      else if (!textRef.current.trim()) {
        const draft = readDraft();
        if (draft) setText(draft);
      }
      const t = window.setTimeout(() => areaRef.current?.focus(), 260);
      return () => window.clearTimeout(t);
    }
    setBusy(null);
  }, [open, seed]);

  // persist the draft as they type — losing a pasted wall of text to a stray swipe is rage
  useEffect(() => {
    const t = window.setTimeout(() => saveDraft(text), 250);
    return () => window.clearTimeout(t);
  }, [text]);

  const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!/\.(txt|md|markdown)$/i.test(f.name) && !/^text\//.test(f.type)) {
      setNudge("txt or md only for now.");
      return;
    }
    try {
      const body = await f.text();
      const prev = textRef.current;
      const joined = prev.trim() ? `${prev.trimEnd()}\n\n${body}` : body;
      // the textarea's maxLength doesn't apply to programmatic text; the server caps input at 400k chars
      const clipped = joined.length > INPUT_MAX;
      setText(clipped ? joined.slice(0, INPUT_MAX) : joined);
      setFile(f.name);
      setNudge(clipped ? "big one — kept the first 400k characters." : null);
    } catch {
      setNudge("couldn't read that file.");
    }
  }, []);

  // reads the clipboard ONLY on tap — never on open, never in the background
  const onPasteChip = useCallback(async () => {
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      if (!clip) {
        setNudge("nothing on the clipboard yet.");
        return;
      }
      setText(clip.slice(0, INPUT_MAX));
      setNudge(clip.length > INPUT_MAX ? "big one — kept the first 400k characters." : null);
      areaRef.current?.focus();
    } catch {
      setNudge("couldn't reach the clipboard — paste it straight in.");
    }
  }, []);

  const submit = useCallback(async () => {
    const raw = text.trim();
    if (!raw || busy) return;
    setNudge(null);
    const route = routeInput(raw, { attachedFile: !!file });
    let body: CreateSessionBody;
    try {
      if (route.kind === "text") {
        body = { input: raw, sourceKind: route.sourceKind, sourceMeta: file ? { filename: file } : {}, settings: { chillMode: chill, depthPreset: depth } };
      } else {
        setBusy("reading");
        const ing = await api.post<IngestData>(ingestPath(route.kind), { url: route.url });
        // titles are capped at 60 chars (D12): clamp at a word boundary, never let a long page title 400 the session
        body = { input: ing.text.slice(0, INPUT_MAX), sourceKind: ing.sourceKind, sourceMeta: { ...ing.meta, url: route.url }, settings: { chillMode: chill, depthPreset: depth }, title: clampTitle(ing.title) };
      }
      setBusy("brewing");
      const res = await api.post<{ session: SessionPublic }>("/api/sessions", body);
      setText("");
      setFile(null);
      saveDraft("");
      router.push(`/s/${res.session.id}`);
    } catch (e) {
      setBusy(null);
      setNudge(sheetError(e));
    }
  }, [text, busy, file, chill, depth, router]);

  const canSend = !!text.trim() && !busy;
  const empty = !text.trim();
  const chips = useMemo(() => suggestionsAt(rot), [rot]);
  const url = useMemo(() => loneUrl(text), [text]);
  const domain = url ? urlDomain(url) : null;

  return (
    <BottomSheet open={open} onClose={busy ? () => {} : onClose} label="new session" tall>
      <div className="flex flex-col gap-3 pb-2">
        <p className="font-display text-xl text-ink">what are we scrolling?</p>
        <textarea
          ref={areaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          maxLength={400_000}
          placeholder="a sentence, a wall of text, or a URL"
          className="w-full resize-none rounded-2xl px-4 py-3 font-body text-base leading-snug text-ink outline-none placeholder:text-ink-2"
          style={{ background: "var(--surface)", border: "1px solid var(--line)", minHeight: 160 }}
          disabled={!!busy}
        />

        {/* a lone URL unfurls quietly: the domain plus what we'll do with it */}
        {url && domain && !busy && (
          <div className="flex items-center gap-2.5 rounded-2xl px-4 py-2.5" style={{ background: "var(--accent-soft)" }}>
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--accent)" }} />
            <span className="shrink-0 font-mono text-xs" style={{ color: "var(--accent)" }}>{domain}</span>
            <span className="truncate font-body text-xs text-ink-2">{unfurlLine(url)}</span>
          </div>
        )}

        {/* suggested starts teach the three shapes: a question, a link, an "explain X like i'm smart" */}
        {empty && !busy && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void onPasteChip()}
              className="rounded-full px-3 py-1.5 font-body text-[13px]"
              style={{ background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid transparent" }}
            >
              paste what you copied
            </button>
            {chips.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => { setText(c.fill); areaRef.current?.focus(); }}
                className="max-w-full truncate rounded-full px-3 py-1.5 font-body text-[13px] text-ink-2"
                style={{ background: "var(--surface)", border: "1px solid var(--line)" }}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" className="hidden" onChange={(e) => void onFile(e)} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!!busy}
            className="rounded-full px-3 py-1.5 font-body text-sm text-ink-2"
            style={{ background: "var(--surface)", border: "1px solid var(--line)" }}
          >
            drop a file in
          </button>
          {file && (
            <span className="flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-xs" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
              <span className="max-w-[160px] truncate">{file}</span>
              <button type="button" aria-label="remove file" onClick={() => setFile(null)} className="opacity-70">
                ×
              </button>
            </span>
          )}
        </div>

        <div className="mt-1 flex items-center justify-between gap-4 rounded-2xl px-4 py-3" style={{ background: "var(--surface)" }}>
          <div>
            <p className="font-body text-[15px] text-ink">chill mode</p>
            <p className="font-body text-xs text-ink-2">just read. no bets, no drags.</p>
          </div>
          <Toggle on={chill} label="chill mode" onChange={setChill} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Segmented value={depth} options={DEPTHS} label="depth" onChange={setDepth} />
          <p className="px-4 font-body text-xs text-ink-2">{DEPTH_LINES[depth]}</p>
        </div>

        {busy && (
          <div className="flex items-center gap-3">
            <div className="shimmer h-1.5 flex-1 rounded-full" aria-hidden />
            <span className="shrink-0 font-body text-xs text-ink-2">
              {busy === "reading" ? "reading the link…" : "lining up your first cards…"}
            </span>
          </div>
        )}
        {nudge && !busy && <p className="font-body text-sm text-ink-2">{nudge}</p>}

        <motion.button
          type="button"
          onClick={() => void submit()}
          disabled={!canSend}
          whileTap={reduced || !canSend ? undefined : { scale: 0.97 }}
          transition={spring}
          className="mt-1 w-full rounded-full px-5 py-3.5 font-display text-lg font-semibold disabled:opacity-40"
          style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
        >
          {busy === "reading" ? "reading the link…" : busy === "brewing" ? "brewing…" : "drip it"}
        </motion.button>
      </div>
    </BottomSheet>
  );
}
