import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { BoxLifecycleButtons } from "@/components/box-lifecycle-buttons";
import { BoxTools } from "@/components/box-tools";
import { Shell } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EnsureboxError, getBox, getInfo } from "@/lib/ensurebox";
import type { Capabilities } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function BoxPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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

  let capabilities: Capabilities | null = null;
  if (box.status === "ready") {
    try {
      const info = await getInfo(id);
      capabilities = info.capabilities ?? null;
    } catch {
      capabilities = null;
    }
  }

  const toolsDisabled = box.status !== "ready";
  const waiting = box.status === "creating";

  return (
    <Shell>
      <AutoRefresh when={waiting} />
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
              ← All boxes
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{box.name}</h1>
            <p className="font-mono text-sm text-zinc-500">{box.id}</p>
          </div>
          <Badge>{box.status}</Badge>
        </div>

        {waiting ? (
          <p className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-600">
            EnsureBox is still creating this guest. This page refreshes until
            status is ready.
          </p>
        ) : null}

        {box.error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {box.error}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Lifecycle</CardTitle>
            <CardDescription>
              Stop, hibernate, start, and destroy are EnsureBox API calls. This
              client never talks to Docker.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BoxLifecycleButtons id={box.id} status={box.status} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Desktop viewer</CardTitle>
            <CardDescription>
              The live viewer URL comes from EnsureBox. Opening it in a browser
              tab is optional; shell and CUA still go through L2.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Viewer{" "}
              <a
                className="font-mono text-primary underline-offset-2 hover:underline"
                href={box.endpoints.viewer}
                target="_blank"
                rel="noreferrer"
              >
                {box.endpoints.viewer}
              </a>
            </p>
            <p>
              VNC password{" "}
              <span className="font-mono">{box.vncPassword}</span>
            </p>
            {capabilities ? (
              <p className="text-zinc-600">
                capabilities:{" "}
                {Object.entries(capabilities)
                  .filter(([, on]) => on)
                  .map(([name]) => name)
                  .join(", ") || "none"}
              </p>
            ) : null}
            <a
              className={buttonVariants({ variant: "outline" })}
              href={box.endpoints.viewer}
              target="_blank"
              rel="noreferrer"
            >
              Open live desktop
            </a>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tools</CardTitle>
            <CardDescription>
              Exec, files, and computer use POST to EnsureBox{" "}
              <code>/api/v1/boxes/{box.id}/…</code>. Disabled unless the guest
              is ready.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BoxTools id={box.id} disabled={toolsDisabled} />
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
