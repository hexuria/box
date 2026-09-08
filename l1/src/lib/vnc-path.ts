export function matchDesktopRfbPath(url: string): string | null {
  const path = url.split("?")[0] ?? "";
  const match = path.match(/^\/api\/desktop\/([^/]+)\/rfb\/?$/);
  if (!match?.[1]) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function ensureboxVncUrl(base: string, id: string): string {
  const httpUrl = new URL(`/api/v1/boxes/${encodeURIComponent(id)}/vnc`, base);
  httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
  return httpUrl.toString();
}

export function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    if (trimmed.slice(0, eq) !== name) {
      continue;
    }
    const raw = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

export function desktopRfbUrl(id: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/desktop/${encodeURIComponent(id)}/rfb`;
}
