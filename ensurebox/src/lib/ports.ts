import net from "node:net";

function canBind(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

export async function allocatePorts(
  host: string,
): Promise<{ exec: number; hostPort: number; novnc: number }> {
  const exec = await findFree(host, 21337);
  const hostPort = await findFree(host, Math.max(21340, exec + 3));
  const novnc = await findFree(host, Math.max(26080, hostPort + 3));
  return { exec, hostPort, novnc };
}

async function findFree(host: string, start: number): Promise<number> {
  for (let port = start; port < start + 200; port += 1) {
    if (await canBind(port, host)) {
      return port;
    }
  }
  throw new Error(`no free port near ${start} on ${host}`);
}
