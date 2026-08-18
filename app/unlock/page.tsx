import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { GATE_COOKIE, gateEnabled, isUnlocked } from "@/lib/gate";
import { UnlockForm } from "./UnlockForm";

export const dynamic = "force-dynamic";

/** The lock screen. Themed like the app shell so it reads as part of drip, not as a login page. */
export default async function Unlock({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const secret = process.env.DRIP_PASSPHRASE;
  const { next } = await searchParams;
  if (!gateEnabled(secret)) redirect("/");
  if (await isUnlocked((await cookies()).get(GATE_COOKIE)?.value, secret)) redirect(next && next.startsWith("/") ? next : "/");
  return <UnlockForm next={next && next.startsWith("/") ? next : "/"} />;
}
