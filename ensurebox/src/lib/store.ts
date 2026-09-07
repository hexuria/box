import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./config";
import type { BoxRecord, OperatorBox, PublicBox } from "./types";

const STORE_PATH = path.join(DATA_DIR, "boxes.json");

type StoreFile = {
  boxes: BoxRecord[];
};

function normalizeRecord(raw: Partial<BoxRecord> & Pick<BoxRecord, "id">): BoxRecord | null {
  if (!raw.id || !raw.boxToken) {
    return null;
  }
  return {
    id: raw.id,
    name: raw.name || raw.id,
    status: raw.status || "error",
    image: raw.image || "",
    containerName: raw.containerName || `ensurebox-${raw.id}`,
    containerId: raw.containerId ?? null,
    boxToken: raw.boxToken,
    vncPassword: typeof raw.vncPassword === "string" ? raw.vncPassword : "",
    ports: raw.ports || { exec: 0, host: 0, novnc: 0 },
    volumes: raw.volumes || { workspace: "", chromeProfile: "" },
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
    error: raw.error ?? null,
  };
}

async function readStore(): Promise<StoreFile> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as StoreFile;
    const boxes = Array.isArray(parsed.boxes)
      ? parsed.boxes
          .map((box) => normalizeRecord(box))
          .filter((box): box is BoxRecord => box != null)
      : [];
    return { boxes };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { boxes: [] };
    }
    throw err;
  }
}

async function writeStore(file: StoreFile): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${STORE_PATH}.tmp`;
  await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  const { rename } = await import("node:fs/promises");
  await rename(tmp, STORE_PATH);
}

export function toPublicBox(box: BoxRecord): PublicBox {
  return {
    id: box.id,
    name: box.name,
    status: box.status,
    image: box.image,
    containerName: box.containerName,
    containerId: box.containerId,
    createdAt: box.createdAt,
    updatedAt: box.updatedAt,
    error: box.error,
  };
}

export function toOperatorBox(box: BoxRecord): OperatorBox {
  return {
    ...toPublicBox(box),
    ports: box.ports,
    volumes: box.volumes,
    endpoints: {
      exec: `http://127.0.0.1:${box.ports.exec}`,
      host: `http://127.0.0.1:${box.ports.host}`,
      viewer: `http://127.0.0.1:${box.ports.novnc}/vnc.html`,
    },
    vncPassword: box.vncPassword,
  };
}

export async function listBoxes(): Promise<BoxRecord[]> {
  const file = await readStore();
  return file.boxes;
}

export async function getBox(id: string): Promise<BoxRecord | null> {
  const file = await readStore();
  return file.boxes.find((box) => box.id === id) ?? null;
}

export async function upsertBox(record: BoxRecord): Promise<BoxRecord> {
  const file = await readStore();
  const index = file.boxes.findIndex((box) => box.id === record.id);
  if (index === -1) {
    file.boxes.push(record);
  } else {
    file.boxes[index] = record;
  }
  await writeStore(file);
  return record;
}

export async function removeBox(id: string): Promise<void> {
  const file = await readStore();
  file.boxes = file.boxes.filter((box) => box.id !== id);
  await writeStore(file);
}
