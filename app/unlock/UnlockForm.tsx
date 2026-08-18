"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion } from "framer-motion";
import { ThemeRoot, useTheme } from "@/components/theme/ThemeRoot";
import { SHELL_THEME } from "@/lib/theme/defaults";
import { shakeKeyframes, shakeTransition } from "@/lib/motion";

function Form({ next }: { next: string }) {
  const { spring, reduced } = useTheme();
  const router = useRouter();
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "wrong">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value || state === "checking") return;
    setState("checking");
    const res = await fetch("/api/unlock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase: value }),
    }).catch(() => null);
    if (res?.ok) {
      router.replace(next);
      router.refresh();
      return;
    }
    setState("wrong");
    setValue("");
  }

  return (
    <main className="flex h-full flex-col items-center justify-center px-7">
      <motion.form
        onSubmit={submit}
        className="w-full max-w-[340px]"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
        animate={
          state === "wrong" && !reduced
            ? { opacity: 1, y: 0, ...shakeKeyframes }
            : { opacity: 1, y: 0 }
        }
        transition={state === "wrong" && !reduced ? shakeTransition : spring}
      >
        <h1 className="font-display text-[34px] leading-none tracking-tight text-ink">drip</h1>
        <p className="mt-2 font-body text-[15px] text-ink-2">
          {state === "wrong" ? "not it. try again." : "say the word."}
        </p>
        <input
          type="password"
          inputMode="text"
          autoFocus
          autoComplete="current-password"
          aria-label="passphrase"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (state === "wrong") setState("idle");
          }}
          className="mt-5 w-full rounded-2xl px-4 py-3 font-body text-base text-ink outline-none"
          style={{
            background: "var(--surface)",
            border: `1px solid ${state === "wrong" ? "var(--state-wrong)" : "var(--line)"}`,
          }}
        />
        <button
          type="submit"
          disabled={!value || state === "checking"}
          className="mt-4 w-full rounded-full py-3 font-body text-base font-semibold"
          style={{
            background: "var(--accent)",
            color: "var(--accent-ink)",
            opacity: !value || state === "checking" ? 0.55 : 1,
          }}
        >
          {state === "checking" ? "checking…" : "let me in"}
        </button>
      </motion.form>
    </main>
  );
}

export function UnlockForm({ next }: { next: string }) {
  return (
    <ThemeRoot theme={SHELL_THEME} className="h-full" as="div">
      <Form next={next} />
    </ThemeRoot>
  );
}
