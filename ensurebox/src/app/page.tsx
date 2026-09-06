import Link from "next/link";
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
import { listPublicBoxes } from "@/lib/lifecycle";
import { GROK_BOX_IMAGE } from "@/lib/config";
import type { PublicBox } from "@/lib/types";

export const dynamic = "force-dynamic";

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
  let boxes: PublicBox[] = [];
  let loadError: string | null = null;
  try {
    boxes = await listPublicBoxes();
  } catch (err) {
    boxes = [];
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <Shell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Boxes</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600">
            EnsureBox is the Layer 2 control plane. It starts a{" "}
            <code className="rounded bg-zinc-100 px-1">{GROK_BOX_IMAGE}</code>{" "}
            guest, waits until <code className="rounded bg-zinc-100 px-1">/v1/ready</code>{" "}
            returns 200, and keeps the box token server-side. Inference stays in L4.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Create</CardTitle>
            <CardDescription>
              Allocates host ports, mounts durable volumes, and does not publish
              VNC 5900 or CDP 9222.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateBoxForm />
          </CardContent>
        </Card>

        {loadError ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : null}

        {boxes.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No boxes yet</CardTitle>
              <CardDescription>
                Create one after the grok-box image exists. If Docker cannot see
                the image, run <code>docker compose build</code> from the repo
                root.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-3">
            {boxes.map((box) => (
              <Link key={box.id} href={`/boxes/${box.id}`}>
                <Card className="transition-colors hover:bg-zinc-50">
                  <CardHeader className="flex flex-row items-start justify-between gap-3">
                    <div>
                      <CardTitle>{box.name}</CardTitle>
                      <CardDescription className="font-mono">{box.id}</CardDescription>
                    </div>
                    <Badge variant={statusVariant(box.status)}>{box.status}</Badge>
                  </CardHeader>
                  <CardContent className="text-sm text-zinc-600">
                    exec :{box.ports.exec} · host :{box.ports.host} · viewer :{box.ports.novnc}
                    {box.error ? (
                      <p className="mt-2 text-destructive">{box.error}</p>
                    ) : null}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}
