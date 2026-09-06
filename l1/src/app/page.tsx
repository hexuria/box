import Link from "next/link";
import { ConnectionBanner } from "@/components/connection-banner";
import { CreateBoxForm } from "@/components/create-box-form";
import { Shell } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { connectionStatus, EnsureboxError, listBoxes } from "@/lib/ensurebox";
import type { PublicBox } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function statusVariant(status: string) {
  if (status === "ready") {
    return "default" as const;
  }
  if (status === "error") {
    return "destructive" as const;
  }
  return "secondary" as const;
}

export default async function HomePage() {
  const status = await connectionStatus();
  let boxes: PublicBox[] = [];
  let loadError: string | null = null;

  if (status.reachable && status.authorized) {
    try {
      boxes = await listBoxes();
    } catch (err) {
      loadError = err instanceof EnsureboxError ? err.message : String(err);
    }
  } else if (status.reachable && status.authorized === false) {
    loadError = "EnsureBox rejected this client's token.";
  } else {
    loadError = status.message;
  }

  const createDisabled = !status.reachable || status.authorized !== true;

  return (
    <Shell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Boxes</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600">
            This is the Layer 1 client. Every action here is an HTTP call to
            EnsureBox. The guest token never leaves L2, and this app does not
            talk to box-exec, box-host, or SSH.
          </p>
        </div>

        <ConnectionBanner status={status} />

        <Card>
          <CardHeader>
            <CardTitle>Create</CardTitle>
            <CardDescription>
              EnsureBox starts a grok-box guest, waits until it is ready, and
              keeps the token server-side. This client only sees the public box.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateBoxForm disabled={createDisabled} />
          </CardContent>
        </Card>

        {loadError && boxes.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Cannot list boxes</CardTitle>
              <CardDescription>{loadError}</CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        {!loadError && boxes.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No boxes yet</CardTitle>
              <CardDescription>
                Create one after EnsureBox can see a <code>grok-box:local</code>{" "}
                image. If L2 is down, start it with{" "}
                <code>cd ensurebox && npm run dev</code>.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        {boxes.length > 0 ? (
          <div className="grid gap-3">
            {boxes.map((box) => (
              <Link key={box.id} href={`/boxes/${box.id}`}>
                <Card className="transition-colors hover:bg-zinc-50">
                  <CardHeader className="flex flex-row items-start justify-between gap-3">
                    <div>
                      <CardTitle>{box.name}</CardTitle>
                      <CardDescription className="font-mono">
                        {box.id}
                      </CardDescription>
                    </div>
                    <Badge variant={statusVariant(box.status)}>{box.status}</Badge>
                  </CardHeader>
                  <CardContent className="text-sm text-zinc-600">
                    {box.image}
                    {box.error ? (
                      <p className="mt-2 text-destructive">{box.error}</p>
                    ) : null}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </Shell>
  );
}
