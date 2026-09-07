import { mkdir, rm, writeFile as writeFs } from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { connectBox, waitUntilReady } from "./box-client";
import { BIND_HOST, DATA_DIR, GROK_BOX_IMAGE, READY_TIMEOUT_MS } from "./config";
import { containerInspect, docker, imageExists } from "./docker";
import { allocatePorts } from "./ports";
import { getBox, listBoxes, removeBox, upsertBox } from "./store";
import type { BoxRecord, Capabilities, PublicBox } from "./types";
import { toPublicBox } from "./store";

function nowIso(): string {
  return new Date().toISOString();
}

function shortId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 10);
}

async function syncStatus(box: BoxRecord): Promise<BoxRecord> {
  if (box.status === "creating" || box.status === "destroying") {
    return box;
  }
  const inspect = await containerInspect(box.containerName);
  let next = box;
  if (!inspect) {
    if (box.status === "ready") {
      next = { ...box, status: "stopped", updatedAt: nowIso() };
    }
  } else if (inspect.running) {
    if (box.status === "stopped" || box.status === "hibernated") {
      next = {
        ...box,
        status: "ready",
        containerId: inspect.id,
        updatedAt: nowIso(),
        error: null,
      };
    } else if (box.containerId !== inspect.id) {
      next = { ...box, containerId: inspect.id, updatedAt: nowIso() };
    }
  } else if (box.status === "ready") {
    next = {
      ...box,
      status: "stopped",
      containerId: inspect.id,
      updatedAt: nowIso(),
    };
  }
  if (next !== box) {
    await upsertBox(next);
  }
  return next;
}

export async function listPublicBoxes(): Promise<PublicBox[]> {
  const boxes = await listBoxes();
  const synced = await Promise.all(boxes.map((box) => syncStatus(box)));
  return synced.map(toPublicBox);
}

export async function getPublicBox(id: string): Promise<PublicBox | null> {
  const box = await getBox(id);
  if (!box) {
    return null;
  }
  return toPublicBox(await syncStatus(box));
}

export async function requireBox(id: string): Promise<BoxRecord> {
  const box = await getBox(id);
  if (!box) {
    throw new Error(`box not found: ${id}`);
  }
  return syncStatus(box);
}

export async function createBox(name?: string): Promise<PublicBox> {
  if (!(await imageExists(GROK_BOX_IMAGE))) {
    throw new Error(
      `image ${GROK_BOX_IMAGE} is not present. From the repo root run: docker compose build`,
    );
  }

  const id = shortId();
  const boxToken = randomBytes(24).toString("base64url");
  const ports = await allocatePorts(BIND_HOST);
  const volumes = {
    workspace: path.join(DATA_DIR, "volumes", id, "workspace"),
    chromeProfile: path.join(DATA_DIR, "volumes", id, "chrome-profile"),
  };
  await mkdir(volumes.workspace, { recursive: true });
  await mkdir(volumes.chromeProfile, { recursive: true });
  const envFile = path.join(DATA_DIR, "volumes", id, "box.env");
  await writeFs(
    envFile,
    [
      `BOX_TOKEN=${boxToken}`,
      `BOX_ID=${id}`,
      "BOX_DESKTOP=1",
      "BOX_DESKTOP_REQUIRED=1",
      "BOX_CHROME=1",
      "BOX_CUA=1",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );

  const record: BoxRecord = {
    id,
    name: name?.trim() || `box-${id}`,
    status: "creating",
    image: GROK_BOX_IMAGE,
    containerName: `ensurebox-${id}`,
    containerId: null,
    boxToken,
    ports: { exec: ports.exec, host: ports.hostPort, novnc: ports.novnc },
    volumes,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    error: null,
  };
  await upsertBox(record);

  try {
    const containerId = await docker([
      "run",
      "-d",
      "--name",
      record.containerName,
      "--label",
      "ensurebox=true",
      "--label",
      `ensurebox.id=${id}`,
      "--shm-size",
      "256m",
      "--env-file",
      envFile,
      "-p",
      `${BIND_HOST}:${record.ports.exec}:1337`,
      "-p",
      `${BIND_HOST}:${record.ports.host}:1340`,
      "-p",
      `${BIND_HOST}:${record.ports.novnc}:6080`,
      "-v",
      `${volumes.workspace}:/workspace`,
      "-v",
      `${volumes.chromeProfile}:/home/box/chrome-profile`,
      record.image,
    ]);

    let ready = { ...record, containerId, updatedAt: nowIso() };
    await upsertBox(ready);
    await waitUntilReady(ready, READY_TIMEOUT_MS);
    ready = {
      ...ready,
      status: "ready",
      error: null,
      updatedAt: nowIso(),
    };
    await upsertBox(ready);
    return toPublicBox(ready);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = {
      ...record,
      status: "error" as const,
      error: message,
      updatedAt: nowIso(),
    };
    await upsertBox(failed);
    try {
      await docker(["rm", "-f", record.containerName]);
    } catch {
      // container may not exist
    }
    throw new Error(message);
  }
}

export async function stopBox(id: string, hibernate = false): Promise<PublicBox> {
  const box = await requireBox(id);
  const inspect = await containerInspect(box.containerName);
  if (inspect?.running) {
    await docker(["stop", box.containerName]);
  }
  const next = {
    ...box,
    status: hibernate ? ("hibernated" as const) : ("stopped" as const),
    updatedAt: nowIso(),
    error: null,
  };
  await upsertBox(next);
  return toPublicBox(next);
}

export async function startBox(id: string): Promise<PublicBox> {
  const box = await requireBox(id);
  const inspect = await containerInspect(box.containerName);
  if (!inspect) {
    throw new Error("container is gone; destroy this record and create a new box");
  }
  if (!inspect.running) {
    await docker(["start", box.containerName]);
  }
  const starting = {
    ...box,
    containerId: inspect.id,
    status: "creating" as const,
    updatedAt: nowIso(),
    error: null,
  };
  await upsertBox(starting);
  await waitUntilReady(starting, READY_TIMEOUT_MS);
  const ready = {
    ...starting,
    status: "ready" as const,
    updatedAt: nowIso(),
  };
  await upsertBox(ready);
  return toPublicBox(ready);
}

export async function destroyBox(id: string): Promise<void> {
  const box = await getBox(id);
  if (!box) {
    return;
  }
  await upsertBox({ ...box, status: "destroying", updatedAt: nowIso() });
  try {
    await docker(["rm", "-f", box.containerName]);
  } catch {
    // already gone
  }
  await rm(path.join(DATA_DIR, "volumes", id), { recursive: true, force: true });
  await removeBox(id);
}

export async function boxInfo(id: string): Promise<unknown> {
  const box = await requireBox(id);
  return connectBox(box).info();
}

export async function boxCapabilities(id: string): Promise<Capabilities | null> {
  try {
    const info = (await boxInfo(id)) as { capabilities?: Capabilities };
    return info.capabilities ?? null;
  } catch {
    return null;
  }
}

export async function execCommand(
  id: string,
  command: string[] | string,
): Promise<unknown> {
  const box = await requireBox(id);
  return connectBox(box).exec({ command });
}

export async function readFile(id: string, filePath: string): Promise<unknown> {
  const box = await requireBox(id);
  return connectBox(box).filesGet(filePath);
}

export async function writeGuestFile(
  id: string,
  filePath: string,
  content: string,
): Promise<unknown> {
  const box = await requireBox(id);
  return connectBox(box).filesPut({ path: filePath, content, create_dirs: true });
}

export async function deleteGuestFile(
  id: string,
  filePath: string,
  recursive = false,
): Promise<unknown> {
  const box = await requireBox(id);
  return connectBox(box).filesDelete(filePath, recursive);
}

export async function mkdirGuest(id: string, filePath: string, parents = true): Promise<unknown> {
  const box = await requireBox(id);
  return connectBox(box).filesMkdir(filePath, parents);
}

export async function screenshot(id: string): Promise<unknown> {
  const box = await requireBox(id);
  return connectBox(box).screenshot();
}

export async function screenshotPng(id: string): Promise<Uint8Array> {
  const box = await requireBox(id);
  return connectBox(box).screenshotPng();
}

export async function click(
  id: string,
  x: number,
  y: number,
  button?: number,
): Promise<unknown> {
  const box = await requireBox(id);
  return connectBox(box).click(x, y, button);
}

export async function doubleClick(
  id: string,
  x: number,
  y: number,
  button?: number,
): Promise<unknown> {
  const box = await requireBox(id);
  return connectBox(box).doubleClick(x, y, button);
}

export async function movePointer(id: string, x: number, y: number): Promise<unknown> {
  const box = await requireBox(id);
  return connectBox(box).move(x, y);
}

export async function drag(
  id: string,
  body: { x1: number; y1: number; x2: number; y2: number; button?: number },
): Promise<unknown> {
  const box = await requireBox(id);
  return connectBox(box).drag(body.x1, body.y1, body.x2, body.y2, body.button);
}

export async function typeText(id: string, text: string): Promise<unknown> {
  const box = await requireBox(id);
  return connectBox(box).type(text);
}

export async function sendKey(id: string, key: string): Promise<unknown> {
  const box = await requireBox(id);
  return connectBox(box).key(key);
}

export async function scroll(
  id: string,
  body: { x: number; y: number; dx: number; dy: number },
): Promise<unknown> {
  const box = await requireBox(id);
  return connectBox(box).scroll(body.x, body.y, body.dx, body.dy);
}
