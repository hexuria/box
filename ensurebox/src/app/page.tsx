import Link from "next/link";
import { CreateBoxForm } from "@/components/create-box-form";
import { LoginForm } from "@/components/login-form";
import { Shell } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isOperatorAuthed } from "@/lib/auth";
import { GROK_BOX_IMAGE, tryGetEnsureboxToken } from "@/lib/config";
import { listOperatorBoxes } from "@/lib/lifecycle";
import type { OperatorBox } from "@/lib/types";

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

function containerState(box: OperatorBox) {
  if (box.status === "ready" || box.status === "creating") {
    return "running";
  }
  if (box.status === "stopped" || box.status === "hibernated") {
    return "stopped";
  }
  return box.status;
}

export default async function HomePage() {
  const configured = tryGetEnsureboxToken();
  if ("error" in configured) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle>Operator console</CardTitle>
            <CardDescription>{configured.error}</CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  const authed = await isOperatorAuthed();
  if (!authed) {
    return (
      <Shell>
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
            <p className="mt-1 max-w-2xl text-sm text-zinc-600">
              This operator console can start and destroy Docker guests. Sign in
              with <code className="rounded bg-zinc-100 px-1">ENSUREBOX_TOKEN</code>.
            </p>
          </div>
          <LoginForm hint="Same token the /api/v1 Bearer header uses." />
        </div>
      </Shell>
    );
  }

  let boxes: OperatorBox[] = [];
  let loadError: string | null = null;
  try {
    boxes = await listOperatorBoxes();
  } catch (err) {
    boxes = [];
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <Shell authed>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Guests</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600">
            Provision <code className="rounded bg-zinc-100 px-1">{GROK_BOX_IMAGE}</code>{" "}
            containers, inspect host ports and volumes, and start or destroy them.
            Shell, files, and computer use belong in the L1 client.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Provision</CardTitle>
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
              <CardTitle>No guests</CardTitle>
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
                  <CardContent className="space-y-1 text-sm text-zinc-600">
                    <p className="font-mono text-xs">{box.image}</p>
                    <p>
                      exec :{box.ports.exec} · host :{box.ports.host} · viewer :{box.ports.novnc}
                    </p>
                    <p>
                      container {containerState(box)}
                      {box.containerId ? (
                        <span className="font-mono">
                          {" "}
                          {box.containerId.slice(0, 12)}
                        </span>
                      ) : (
                        " (none)"
                      )}
                    </p>
                    {box.error ? (
                      <p className="text-destructive">{box.error}</p>
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
