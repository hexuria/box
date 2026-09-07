import { requireEnsureboxToken } from "@/lib/auth";
import { handleRouteError } from "@/lib/http";
import { screenshot, screenshotPng } from "@/lib/lifecycle";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const unauthorized = requireEnsureboxToken(request);
  if (unauthorized) {
    return unauthorized;
  }
  const { id } = await params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  const accept = request.headers.get("accept") || "";
  const wantPng = format === "png" || accept.includes("image/png");
  try {
    if (wantPng) {
      const png = await screenshotPng(id);
      return new Response(Buffer.from(png), {
        headers: { "content-type": "image/png" },
      });
    }
    const result = await screenshot(id);
    return Response.json(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
