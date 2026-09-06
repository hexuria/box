import { connectionStatus } from "@/lib/ensurebox";
import { ENSUREBOX_URL } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const ensurebox = await connectionStatus();
  const ok = ensurebox.reachable && ensurebox.authorized === true;
  return Response.json(
    {
      status: ok ? "ok" : "degraded",
      service: "l1",
      protocol: "v1",
      version: "0.1.0",
      ensurebox: {
        url: ENSUREBOX_URL,
        reachable: ensurebox.reachable,
        authorized: ensurebox.authorized,
        protocol: ensurebox.protocol,
        message: ensurebox.message,
      },
    },
    { status: ok ? 200 : 503 },
  );
}
