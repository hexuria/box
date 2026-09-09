export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { installEnsureboxVncUpgrade } = await import("./lib/vnc-upgrade");
  installEnsureboxVncUpgrade();
}
