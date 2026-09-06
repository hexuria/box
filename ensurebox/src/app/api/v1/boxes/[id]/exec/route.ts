import { requireEnsureboxToken } from "@/lib/auth";
import { handleRouteError } from "@/lib/http";
import { execCommand } from "@/lib/lifecycle";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const unauthorized = requireEnsureboxToken(request);
  if (unauthorized) {
    return unauthorized;
  }
  const { id } = await params;
  try {
    const body = (await request.json()) as { command?: string[] | string };
    if (body.command == null) {
      return Response.json(
        { error: { code: "invalid_request", message: "command is required", status: 400 } },
        { status: 400 },
      );
    }
    const result = await execCommand(id, body.command);
    return Response.json(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
