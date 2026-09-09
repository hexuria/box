export function matchEnsureboxVncPath(url: string): string | null {
  const path = url.split("?")[0] ?? "";
  const match = path.match(/^\/api\/v1\/boxes\/([^/]+)\/vnc\/?$/);
  if (!match?.[1]) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function loopbackConnectHost(bindHost: string): string {
  if (bindHost === "0.0.0.0" || bindHost === "::" || bindHost === "[::]" || bindHost === "*") {
    return "127.0.0.1";
  }
  return bindHost;
}
