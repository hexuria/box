export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { installL1VncUpgrade } = await import("./lib/vnc-upgrade");
  installL1VncUpgrade();
}
