import Link from "next/link";
import { ConnectionBanner } from "@/components/connection-banner";
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
import { isL1Authed } from "@/lib/auth";
import { tryGetL1Token } from "@/lib/config";
import { connectionStatus, EnsureboxError, listBoxes } from "@/lib/ensurebox";
import type { PublicBox } from "@/lib/types";

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
  const configured = tryGetL1Token();
  if ("error" in configured) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle>Client is not configured</CardTitle>
            <CardDescription>{configured.error}</CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  const authed = await isL1Authed();
  if (!authed) {
    return (
      <Shell>
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
            <p className="mt-1 max-w-2xl text-sm text-zinc-600">
              This client talks only to EnsureBox. Sign in with the L1 token.
              Guest credentials never reach the browser.
            </p>
          </div>
          <LoginForm hint="Set L1_TOKEN in l1/.env. This is not the guest bearer." />
        </div>
      </Shell>
    );
  }

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
    loadError = "The control plane rejected this client.";
  } else {
    loadError = status.message;
  }

  const createDisabled = !status.reachable || status.authorized !== true;

  return (
    <Shell authed>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workspaces</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600">
            Open a box to drive the Linux desktop (click, type, maximize),
            record a recipe, or run a one-call plan. Guest tokens never reach
            this client.
          </p>
        </div>

        <ConnectionBanner status={status} />

        <Card>
          <CardHeader>
            <CardTitle>New workspace</CardTitle>
            <CardDescription>
              Starts a Linux desktop you can drive from here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateBoxForm disabled={createDisabled} />
          </CardContent>
        </Card>

        {loadError && boxes.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Can&apos;t reach your boxes</CardTitle>
              <CardDescription>{loadError}</CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        {!loadError && boxes.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No workspaces yet</CardTitle>
              <CardDescription>
                Create one to open a desktop and a shell.
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
                      <CardDescription>{box.id}</CardDescription>
                    </div>
                    <Badge variant={statusVariant(box.status)}>
                      {humanStatus(box.status)}
                    </Badge>
                  </CardHeader>
                  {box.error ? (
                    <CardContent className="text-sm text-destructive">
                      {box.error}
                    </CardContent>
                  ) : null}
                </Card>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </Shell>
  );
}
