/** Paths the Files tab sends to EnsureBox, relative to the guest workspace. */

export type GuestEntryKind = "file" | "dir";

const MAX_ENTRY_NAME_BYTES = 255;

/** Validate a single path segment for Create folder / Create file. */
export function guestEntryName(
  raw: string,
  kind: GuestEntryKind,
): { name: string } | { error: string } {
  const name = raw.trim();
  if (!name) {
    return {
      error: kind === "dir" ? "Enter a folder name." : "Enter a file name.",
    };
  }
  if (name === "." || name === "..") {
    return { error: "Name cannot be “.” or “..”." };
  }
  if (/[/\\]/.test(name)) {
    return { error: "Use a single name without slashes." };
  }
  if (/[\u0000-\u001f]/.test(name)) {
    return { error: "Name contains characters that are not allowed." };
  }
  if (new TextEncoder().encode(name).length > MAX_ENTRY_NAME_BYTES) {
    return { error: "Name is too long." };
  }
  return { name };
}

export function workspaceRelative(path: string): string {
  const normalized = path.replaceAll("\\", "/").trim();
  if (!normalized || normalized === "." || normalized === "/workspace") {
    return "";
  }
  return normalized.replace(/^\/workspace\/?/, "").replace(/^\/+/, "");
}

export function joinWorkspace(dir: string, name: string): string {
  const base = workspaceRelative(dir);
  const leaf = name.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!leaf || leaf === ".") {
    return base;
  }
  if (leaf === "..") {
    return parentPath(base);
  }
  return base ? `${base}/${leaf}` : leaf;
}

export function parentPath(path: string): string {
  const rel = workspaceRelative(path);
  if (!rel) {
    return "";
  }
  const parts = rel.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function displayPath(path: string): string {
  const rel = workspaceRelative(path);
  return rel ? `/workspace/${rel}` : "/workspace";
}
