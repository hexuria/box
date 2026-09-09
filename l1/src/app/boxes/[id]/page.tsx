import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { BoxTools } from "@/components/box-tools";
import { WorkspaceOverflowMenu } from "@/components/delete-workspace";
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
    const message = err instanceof Error ? err.message : String(err);
    return (
      <Shell authed>
        <div className="space-y-4">
          <Link href="/" className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
            ← Workspaces
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Can&apos;t open this workspace</h1>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">{message}</p>
          <p className="text-sm text-muted-foreground">
            If the workspace cannot be reached, try again in a moment.
          </p>
        </div>
      </Shell>
    );
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
            <Link href="/" className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
              ← Workspaces
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{box.name}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{humanStatus(box.status)}</Badge>
            <WakeButton id={box.id} status={box.status} />
            <WorkspaceOverflowMenu id={box.id} name={box.name} />
          </div>
        </div>

        {waiting ? (
          <p className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
            This workspace is still starting. The page refreshes until it is
            ready.
          </p>
        ) : null}

        {asleep ? (
          <p className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
            This workspace is offline. Start it to use the shell and desktop.
          </p>
        ) : null}

        {box.error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {box.error}
          </p>
        ) : null}

        {!asleep ? (
          <p className="text-sm leading-6 text-muted-foreground">
            Desktop is a live VNC session through EnsureBox. Teach a task from
            the expanded view; Cook a plan on Recipe. Cook does not restart this
            guest — Desktop stays on the same X session.
          </p>
        ) : null}

        <BoxTools id={box.id} workspaceName={box.name} disabled={toolsDisabled} />
      </div>
    </Shell>
  );
}
