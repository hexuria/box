import { displayPath, workspaceRelative } from "./workspace-path";

export const COOK_ARTIFACT_ROOT = ".l1/cooks";

export type CookArtifactKind = "screenshot" | "recording";

export type CookArtifact = {
  kind: CookArtifactKind;
  label: string;
  path: string;
  mime: string;
  bytes?: number;
  width?: number;
  height?: number;
  stepIndex?: number;
};

export function newCookRunId(): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${rand}`;
}

export function cookArtifactDir(runId: string): string {
  const id = runId.trim().replace(/[^a-zA-Z0-9_-]/g, "");
  return `${COOK_ARTIFACT_ROOT}/${id || "cook"}`;
}

export function isCookArtifactPath(path: string): boolean {
  const rel = workspaceRelative(path);
  if (!rel.startsWith(`${COOK_ARTIFACT_ROOT}/`)) {
    return false;
  }
  if (rel.split("/").some((part) => part === "..")) {
    return false;
  }
  return rel.length > COOK_ARTIFACT_ROOT.length + 1;
}

export function cookArtifactMime(path: string): string {
  const rel = workspaceRelative(path).toLowerCase();
  if (rel.endsWith(".png")) {
    return "image/png";
  }
  if (rel.endsWith(".jpg") || rel.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (rel.endsWith(".webm")) {
    return "video/webm";
  }
  if (rel.endsWith(".mp4") || rel.endsWith(".m4v")) {
    return "video/mp4";
  }
  return "application/octet-stream";
}

export function artifactFileUrl(boxId: string, path: string): string {
  const rel = workspaceRelative(path);
  return `/api/boxes/${encodeURIComponent(boxId)}/files/raw?path=${encodeURIComponent(rel)}`;
}

export function artifactDownloadName(path: string): string {
  const rel = workspaceRelative(path);
  const leaf = rel.split("/").filter(Boolean).pop();
  return leaf || "artifact";
}

type ShotLike = {
  png_base64?: string;
  path?: string;
  mime?: string;
  width?: number;
  height?: number;
  bytes?: number;
};

type StepLike = {
  index?: number;
  screenshot?: ShotLike;
};

type ReceiptLike = {
  screenshot?: ShotLike;
  steps?: StepLike[];
  artifacts?: Array<{
    kind?: string;
    label?: string;
    path?: string;
    mime?: string;
    bytes?: number;
    width?: number;
    height?: number;
    step_index?: number;
  }>;
};

function fromShot(
  shot: ShotLike | undefined,
  label: string,
  stepIndex?: number,
): CookArtifact | null {
  if (!shot?.path) {
    return null;
  }
  const mime = shot.mime || cookArtifactMime(shot.path);
  const kind: CookArtifactKind = mime.startsWith("video/") ? "recording" : "screenshot";
  return {
    kind,
    label,
    path: shot.path,
    mime,
    bytes: shot.bytes,
    width: shot.width,
    height: shot.height,
    stepIndex,
  };
}

export function artifactsFromReceipt(raw: ReceiptLike): CookArtifact[] {
  const out: CookArtifact[] = [];
  const seen = new Set<string>();
  function push(item: CookArtifact | null) {
    if (!item) {
      return;
    }
    const key = workspaceRelative(item.path);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push({ ...item, path: displayPath(key) });
  }
  for (const item of raw.artifacts ?? []) {
    if (!item?.path) {
      continue;
    }
    const mime = item.mime || cookArtifactMime(item.path);
    const kind: CookArtifactKind =
      item.kind === "recording" || mime.startsWith("video/") ? "recording" : "screenshot";
    push({
      kind,
      label: item.label || (kind === "recording" ? "cook recording" : "screenshot"),
      path: item.path,
      mime,
      bytes: item.bytes,
      width: item.width,
      height: item.height,
      stepIndex: item.step_index,
    });
  }
  push(fromShot(raw.screenshot, "end"));
  for (const step of raw.steps ?? []) {
    const index = typeof step.index === "number" ? step.index : undefined;
    push(fromShot(step.screenshot, `step ${index ?? "?"}`, index));
  }
  return out;
}

export function pngsToPersist(raw: ReceiptLike): Array<{
  name: string;
  png: string;
  label: string;
  stepIndex?: number;
  width?: number;
  height?: number;
}> {
  const out: Array<{
    name: string;
    png: string;
    label: string;
    stepIndex?: number;
    width?: number;
    height?: number;
  }> = [];
  const seen = new Set<string>();
  function take(shot: ShotLike | undefined, name: string, label: string, stepIndex?: number) {
    if (!shot?.png_base64 || seen.has(shot.png_base64.slice(0, 80) + String(shot.png_base64.length))) {
      return;
    }
    if (shot.path) {
      return;
    }
    seen.add(shot.png_base64.slice(0, 80) + String(shot.png_base64.length));
    out.push({
      name,
      png: shot.png_base64,
      label,
      stepIndex,
      width: shot.width,
      height: shot.height,
    });
  }
  take(raw.screenshot, "end.png", "end");
  for (const step of raw.steps ?? []) {
    const index = typeof step.index === "number" ? step.index : out.length;
    take(step.screenshot, `step-${String(index).padStart(2, "0")}.png`, `step ${index}`, index);
  }
  return out;
}
