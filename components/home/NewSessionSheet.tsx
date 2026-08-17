"use client";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiClientError } from "@/lib/api/client";
import type { CreateSessionBody, IngestData, SessionPublic } from "@/lib/api/contract";
import { ingestPath, routeInput } from "@/lib/feed/input";
import type { DepthPreset } from "@/lib/schemas/learner";
import { useTheme } from "@/components/theme/ThemeRoot";
import { BottomSheet, Segmented, Toggle } from "./BottomSheet";

const DEPTHS: { value: DepthPreset; label: string }[] = [
  { value: "skim", label: "skim" },
  { value: "standard", label: "standard" },
  { value: "deep", label: "deep" },
];

/**
 * NEW SESSION (spec §2): one big textarea (sentence / wall of text / URL),
 * attach .txt/.md, chill + depth toggles, "drip it". URL inputs go through
 * /api/ingest/* first; ingest errors show in-sheet (never a hang). Then
 * POST /api/sessions and navigate straight to the feed — it handles planning.
 */
export function NewSessionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { spring, reduced } = useTheme();
  const [text, setText] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [chill, setChill] = useState(false);
  const [depth, setDepth] = useState<DepthPreset>("standard");
  const [busy, setBusy] = useState<null | "reading" | "brewing">(null);
  const [nudge, setNudge] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setNudge(null);
      const t = window.setTimeout(() => areaRef.current?.focus(), 260);
      return () => window.clearTimeout(t);
    }
    setBusy(null);
  }, [open]);

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
      setText((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${body}` : body));
      setFile(f.name);
      setNudge(null);
    } catch {
      setNudge("couldn't read that file.");
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
        body = { input: ing.text, sourceKind: ing.sourceKind, sourceMeta: { ...ing.meta, url: route.url }, settings: { chillMode: chill, depthPreset: depth }, title: ing.title };
      }
      setBusy("brewing");
      const res = await api.post<{ session: SessionPublic }>("/api/sessions", body);
      setText("");
      setFile(null);
      router.push(`/s/${res.session.id}`);
    } catch (e) {
      setBusy(null);
      const msg = e instanceof ApiClientError && e.status < 500 ? e.message : "that didn't go through. try again?";
      setNudge(msg.toLowerCase());
    }
  }, [text, busy, file, chill, depth, router]);

  const canSend = !!text.trim() && !busy;

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
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" className="hidden" onChange={(e) => void onFile(e)} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!!busy}
            className="rounded-full px-3 py-1.5 font-body text-sm text-ink-2"
            style={{ background: "var(--surface)", border: "1px solid var(--line)" }}
          >
            + attach .txt / .md
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
        <Segmented value={depth} options={DEPTHS} label="depth" onChange={setDepth} />

        {busy && <div className="shimmer h-1.5 w-full rounded-full" aria-label={busy === "reading" ? "reading the link" : "brewing"} />}
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
