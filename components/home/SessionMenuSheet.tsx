"use client";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import type { SessionPublic } from "@/lib/api/contract";
import type { DepthPreset } from "@/lib/schemas/learner";
import { useTheme } from "@/components/theme/ThemeRoot";
import { BottomSheet, Segmented, Toggle } from "./BottomSheet";

const DEPTHS: { value: DepthPreset; label: string }[] = [
  { value: "skim", label: "skim" },
  { value: "standard", label: "standard" },
  { value: "deep", label: "deep" },
];

/**
 * Long-press menu for a session tile: chill mode / depth / remix / delete.
 * Settings PATCH immediately; delete asks for a second tap.
 */
export function SessionMenuSheet({
  session,
  onClose,
  onChanged,
}: {
  session: SessionPublic | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const { spring, reduced } = useTheme();
  const [chill, setChill] = useState(false);
  const [depth, setDepth] = useState<DepthPreset>("standard");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState<null | "remix" | "delete">(null);
  const [nudge, setNudge] = useState<string | null>(null);

  useEffect(() => {
    if (session) {
      setChill(!!session.settings.chillMode);
      setDepth(session.settings.depthPreset ?? "standard");
      setArmed(false);
      setBusy(null);
      setNudge(null);
    }
  }, [session]);

  const patch = async (settings: Partial<SessionPublic["settings"]>) => {
    if (!session) return;
    try {
      await api.patch(`/api/sessions/${session.id}`, { settings });
      onChanged();
    } catch {
      setNudge("couldn't save that. try again in a sec.");
    }
  };

  const remix = async () => {
    if (!session || busy) return;
    setBusy("remix");
    try {
      const res = await api.post<{ session: SessionPublic }>(`/api/sessions/${session.id}/remix`, { settings: { chillMode: chill, depthPreset: depth } });
      onChanged();
      router.push(`/s/${res.session.id}`);
    } catch {
      setBusy(null);
      setNudge("remix didn't take. one more?");
    }
  };

  const del = async () => {
    if (!session || busy) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy("delete");
    try {
      await api.del(`/api/sessions/${session.id}`);
      onChanged();
      onClose();
    } catch {
      setBusy(null);
      setNudge("still here. try deleting again.");
    }
  };

  return (
    <BottomSheet open={!!session} onClose={onClose} label="session options">
      {session && (
        <div className="flex flex-col gap-4 pb-2">
          <p className="font-display text-lg leading-tight text-ink text-balance">{session.title || "untitled"}</p>

          <div className="flex items-center justify-between gap-4 rounded-2xl px-4 py-3" style={{ background: "var(--surface)" }}>
            <div>
              <p className="font-body text-[15px] text-ink">chill mode</p>
              <p className="font-body text-xs text-ink-2">just read. no bets, no drags.</p>
            </div>
            <Toggle on={chill} label="chill mode" onChange={(v) => { setChill(v); void patch({ chillMode: v }); }} />
          </div>

          <div className="flex flex-col gap-2">
            <p className="px-1 font-body text-xs uppercase tracking-wide text-ink-2">depth</p>
            <Segmented value={depth} options={DEPTHS} label="depth" onChange={(v) => { setDepth(v); void patch({ depthPreset: v }); }} />
          </div>

          {nudge && <p className="font-body text-sm text-ink-2">{nudge}</p>}

          <div className="mt-1 flex items-center gap-3">
            <motion.button
              type="button"
              onClick={() => void remix()}
              disabled={!!busy}
              whileTap={reduced ? undefined : { scale: 0.97 }}
              transition={spring}
              className={"flex-1 rounded-full px-4 py-3 font-body text-sm font-semibold disabled:opacity-50" + (busy === "remix" ? " shimmer" : "")}
              style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
            >
              {busy === "remix" ? "remixing…" : "remix into a fresh one"}
            </motion.button>
            <motion.button
              type="button"
              onClick={() => void del()}
              disabled={!!busy}
              whileTap={reduced ? undefined : { scale: 0.97 }}
              transition={spring}
              className="rounded-full px-4 py-3 font-body text-sm disabled:opacity-50"
              style={{ background: armed ? "var(--state-wrong)" : "var(--surface)", color: armed ? "var(--bg)" : "var(--ink-2)" }}
            >
              {busy === "delete" ? "gone…" : armed ? "sure? tap again" : "delete"}
            </motion.button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
