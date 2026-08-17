import { Splash } from "@/components/home/Splash";
import { ThemeRoot } from "@/components/theme/ThemeRoot";
import { SHELL_THEME } from "@/lib/theme/defaults";

/** Themed shell splash while the session + first cards load. No spinner. */
export default function Loading() {
  return (
    <ThemeRoot theme={SHELL_THEME} className="app-shell">
      <Splash className="h-full w-full" />
    </ThemeRoot>
  );
}
