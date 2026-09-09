"use client";

import { useMemo, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  artifactDownloadName,
  artifactFileUrl,
  type CookArtifact,
} from "@/lib/cook-artifacts";

export function CookArtifactGallery({
  boxId,
  artifacts,
  recordingError,
}: {
  boxId: string;
  artifacts: CookArtifact[];
  recordingError?: string | null;
}) {
  const [open, setOpen] = useState<CookArtifact | null>(null);
  const shots = useMemo(
    () => artifacts.filter((item) => item.kind === "screenshot"),
    [artifacts],
  );
  const recordings = useMemo(
    () => artifacts.filter((item) => item.kind === "recording"),
    [artifacts],
  );

  if (artifacts.length === 0 && !recordingError) {
    return (
      <div className="space-y-1 rounded-xl border border-border bg-muted/20 px-3 py-3">
        <p className="text-sm font-medium">No cook artifacts</p>
        <p className="text-sm text-muted-foreground">
          This run did not store a screenshot or recording L1 can open. Leave
          screenshot on <span className="font-mono">end</span> (or add a
          screenshot step), keep Record cook on, and cook again. Files land under{" "}
          <span className="font-mono">/workspace/.l1/cooks</span> and show here —
          not only as a guest path you cannot preview.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {recordings.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Cook recording
          </p>
          {recordings.map((item) => {
            const src = artifactFileUrl(boxId, item.path);
            return (
              <div key={item.path} className="space-y-2">
                <video
                  controls
                  src={src}
                  className="w-full max-w-3xl rounded-lg border border-border bg-black"
                >
                  Your browser cannot play this cook recording.
                </video>
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={src}
                    download={artifactDownloadName(item.path)}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Download recording
                  </a>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {item.path}
                    {item.bytes != null ? ` · ${item.bytes} bytes` : ""}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : recordingError ? (
        <div className="space-y-1 rounded-xl border border-border bg-muted/20 px-3 py-3">
          <p className="text-sm font-medium">No cook recording</p>
          <p className="text-sm text-muted-foreground">{recordingError}</p>
        </div>
      ) : null}

      {shots.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Screenshots
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {shots.map((item) => {
              const src = artifactFileUrl(boxId, item.path);
              return (
                <button
                  key={item.path}
                  type="button"
                  className="cursor-pointer overflow-hidden rounded-lg border border-border bg-black text-left hover:border-foreground/40"
                  onClick={() => setOpen(item)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={item.label}
                    src={src}
                    className="aspect-[1280/800] w-full object-cover"
                  />
                  <span className="block truncate px-2 py-1 text-[11px] text-muted-foreground">
                    {item.label}
                    {item.width && item.height ? ` · ${item.width}×${item.height}` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No screenshot file on this receipt. If screenshot was{" "}
          <span className="font-mono">none</span>, that is expected. Otherwise
          the PNG never became an L1-viewable artifact.
        </p>
      )}

      <Dialog open={open != null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="sm:max-w-4xl" showCloseButton>
          {open ? (
            <>
              <DialogHeader>
                <DialogTitle>{open.label}</DialogTitle>
                <DialogDescription>
                  {open.path}
                  {open.width && open.height ? ` · ${open.width}×${open.height}` : ""}
                </DialogDescription>
              </DialogHeader>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt={open.label}
                src={artifactFileUrl(boxId, open.path)}
                className="w-full rounded-lg border border-border bg-black"
              />
              <div>
                <a
                  href={artifactFileUrl(boxId, open.path)}
                  download={artifactDownloadName(open.path)}
                  className={buttonVariants({ variant: "outline" })}
                >
                  Download PNG
                </a>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
