import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./config";
import type { BoxRecord, PublicBox } from "./types";

const STORE_PATH = path.join(DATA_DIR, "boxes.json");

type StoreFile = {
  boxes: BoxRecord[];
};

async function readStore(): Promise<StoreFile> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as StoreFile;
    return { boxes: Array.isArray(parsed.boxes) ? parsed.boxes : [] };
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
    ports: box.ports,
    volumes: box.volumes,
    createdAt: box.createdAt,
    updatedAt: box.updatedAt,
    error: box.error,
    endpoints: {
      exec: `http://127.0.0.1:${box.ports.exec}`,
      host: `http://127.0.0.1:${box.ports.host}`,
      viewer: `http://127.0.0.1:${box.ports.novnc}/vnc.html`,
    },
    vncPassword: box.boxToken.slice(0, 8),
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
