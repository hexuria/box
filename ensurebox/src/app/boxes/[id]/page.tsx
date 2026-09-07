import Link from "next/link";
import { notFound } from "next/navigation";
import { BoxLifecycleButtons } from "@/components/box-lifecycle-buttons";
import { LoginForm } from "@/components/login-form";
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
import { isOperatorAuthed } from "@/lib/auth";
import { tryGetEnsureboxToken } from "@/lib/config";
import { getOperatorBox } from "@/lib/lifecycle";

export const dynamic = "force-dynamic";

function containerState(status: string) {
  if (status === "ready" || status === "creating") {
    return "running";
  }
  if (status === "stopped" || status === "hibernated") {
    return "stopped";
  }
  return status;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:items-start">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="break-all font-mono text-xs sm:text-sm">{value}</dd>
    </div>
  );
}

export default async function BoxPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const configured = tryGetEnsureboxToken();
  if ("error" in configured) {
    return (
      <Shell>
        <p className="text-sm text-destructive">{configured.error}</p>
      </Shell>
    );
  }

  const authed = await isOperatorAuthed();
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
  const box = await getOperatorBox(id);
  if (!box) {
    notFound();
  }

  return (
    <Shell authed>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
              ← All guests
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{box.name}</h1>
            <p className="font-mono text-sm text-zinc-500">{box.id}</p>
          </div>
          <Badge>{box.status}</Badge>
        </div>

        {box.error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {box.error}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Lifecycle</CardTitle>
            <CardDescription>
              Stop keeps the container. Hibernate is stop plus retained volumes.
              Destroy deletes the container and the workspace/profile mounts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BoxLifecycleButtons id={box.id} status={box.status} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Container</CardTitle>
            <CardDescription>
              Docker identity synced from inspect. The guest bearer token stays
              on this server and is never sent to L1.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <Field label="image" value={box.image} />
              <Field label="name" value={box.containerName} />
              <Field
                label="id"
                value={box.containerId ?? "none"}
              />
              <Field label="state" value={containerState(box.status)} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Volumes</CardTitle>
            <CardDescription>
              Host paths mounted into the guest. Hibernate keeps these; destroy
              deletes them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <Field label="workspace" value={box.volumes.workspace} />
              <Field label="chrome" value={box.volumes.chromeProfile} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ports</CardTitle>
            <CardDescription>
              Published on this host (loopback). L1 must not call exec or host
              directly. noVNC on 6080 is not Bearer-authenticated.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <dl className="space-y-3">
              <Field
                label="exec"
                value={`${box.endpoints.exec}  (:${box.ports.exec} → 1337)`}
              />
              <Field
                label="host"
                value={`${box.endpoints.host}  (:${box.ports.host} → 1340)`}
              />
              <Field
                label="viewer"
                value={`${box.endpoints.viewer}  (:${box.ports.novnc} → 6080)`}
              />
              <Field
                label="VNC password"
                value={
                  box.vncPassword
                    ? box.vncPassword
                    : "not stored — destroy and recreate this guest"
                }
              />
            </dl>
            <p className="text-xs text-zinc-500">
              Independent of the guest bearer token. x11vnc uses at most 8
              characters.
            </p>
            <a
              className={buttonVariants({ variant: "outline" })}
              href={box.endpoints.viewer}
              target="_blank"
              rel="noreferrer"
            >
              Open viewer
            </a>
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
