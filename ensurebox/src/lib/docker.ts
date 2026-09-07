import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class DockerError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "DockerError";
  }
}

async function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: 120_000,
      maxBuffer: 12 * 1024 * 1024,
    });
    return { stdout: stdout.toString(), stderr: stderr.toString() };
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; message: string; code?: string };
    throw new DockerError(
      error.stderr?.toString().trim() || error.message,
      error.stderr?.toString() || "",
    );
  }
}

async function dockerRaw(args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await run("docker", args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/permission denied|cannot connect to the docker daemon|dial unix|enoent|not found/i.test(message)) {
      throw new DockerError(
        "docker is not available as the current user. Add this account to the docker group and re-login, or point DOCKER_HOST at a reachable socket. EnsureBox does not fall back to sudo.",
        message,
      );
    }
    throw err;
  }
}

export async function docker(args: string[]): Promise<string> {
  const { stdout } = await dockerRaw(args);
  return stdout.trim();
}

export async function dockerOk(args: string[]): Promise<boolean> {
  try {
    await docker(args);
    return true;
  } catch {
    return false;
  }
}

export async function imageExists(image: string): Promise<boolean> {
  try {
    await docker(["image", "inspect", image]);
    return true;
  } catch {
    return false;
  }
}

export async function containerInspect(
  name: string,
): Promise<{ running: boolean; id: string } | null> {
  try {
    const raw = await docker([
      "inspect",
      "--format",
      "{{.Id}} {{.State.Running}}",
      name,
    ]);
    const [id, running] = raw.split(" ");
    if (!id) {
      return null;
    }
    return { id, running: running === "true" };
  } catch {
    return null;
  }
}
