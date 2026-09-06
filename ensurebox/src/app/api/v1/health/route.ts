import { PROTOCOL_VERSION } from "@/lib/config";

export async function GET() {
  return Response.json({
    status: "ok",
    service: "ensurebox",
    protocol: PROTOCOL_VERSION,
    version: "0.1.0",
  });
}
