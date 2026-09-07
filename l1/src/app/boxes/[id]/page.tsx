import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { BoxTools } from "@/components/box-tools";
import { LoginForm } from "@/components/login-form";
import { Shell } from "@/components/shell";
import { WakeButton } from "@/components/wake-button";
import { Badge } from "@/components/ui/badge";
import { isL1Authed } from "@/lib/auth";
import { tryGetL1Token } from "@/lib/config";
import { EnsureboxError, getBox } from "@/lib/ensurebox";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function humanStatus(status: string) {
  if (status === "ready") {
    return "Ready";
  }
  if (status === "creating") {
    return "Starting";
  }
  if (status === "error") {
    return "Error";
  }
  return "Offline";
}

export default async function BoxPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const configured = tryGetL1Token();
  if ("error" in configured) {
    return (
      <Shell>
        <p className="text-sm text-destructive">{configured.error}</p>
      </Shell>
    );
  }

  const authed = await isL1Authed();
  if (!authed) {
    return (
      <Shell>
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <LoginForm />
        </div>
      </Shell>
    );
  }

  const { id } = await params;
  let box;
  try {
    box = await getBox(id);
  } catch (err) {
    if (err instanceof EnsureboxError && err.status === 404) {
      notFound();
    }
    throw err;
  }

  const toolsDisabled = box.status !== "ready";
  const waiting = box.status === "creating";
  const asleep =
    box.status === "stopped" ||
    box.status === "hibernated" ||
    box.status === "error";

  return (
    <Shell authed>
      <AutoRefresh when={waiting} />
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
              ← Workspaces
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{box.name}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{humanStatus(box.status)}</Badge>
            <WakeButton id={box.id} status={box.status} />
          </div>
        </div>

        {waiting ? (
          <p className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-600">
            This workspace is still starting. The page refreshes until it is
            ready.
          </p>
        ) : null}

        {asleep ? (
          <p className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-600">
            This workspace is offline. Start it to use the shell and desktop.
          </p>
        ) : null}

        {box.error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {box.error}
          </p>
        ) : null}

        {!asleep ? (
          <p className="text-sm text-zinc-600">
            Desktop is the screenshot tab (1280×800, top-left origin). Recipe
            runs a multi-step plan in one EnsureBox call. This client does not
            open guest viewer ports.
          </p>
        ) : null}

        <BoxTools id={box.id} disabled={toolsDisabled} />
      </div>
    </Shell>
  );
}
