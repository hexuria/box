import Link from "next/link";
import { notFound } from "next/navigation";
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
import { boxCapabilities, getPublicBox } from "@/lib/lifecycle";

export const dynamic = "force-dynamic";

export default async function BoxPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const box = await getPublicBox(id);
  if (!box) {
    notFound();
  }
  const capabilities =
    box.status === "ready" ? await boxCapabilities(id) : null;
  const toolsDisabled = box.status !== "ready";

  return (
    <Shell>
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
            <CardTitle>Endpoints</CardTitle>
            <CardDescription>
              L1 and operators talk to EnsureBox, not to these ports directly,
              except the noVNC viewer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              exec <span className="font-mono">{box.endpoints.exec}</span>
            </p>
            <p>
              host <span className="font-mono">{box.endpoints.host}</span>
            </p>
            <p>
              viewer{" "}
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
              <span className="text-zinc-500"> (first 8 of the box token)</span>
            </p>
            {capabilities ? (
              <p className="pt-2 text-zinc-600">
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
              Open desktop
            </a>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tools</CardTitle>
            <CardDescription>
              Routed through EnsureBox with the box token. Disabled unless the
              guest is ready.
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
