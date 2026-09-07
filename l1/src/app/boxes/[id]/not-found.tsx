import Link from "next/link";
import { Shell } from "@/components/shell";

export default function NotFound() {
  return (
    <Shell>
      <h1 className="text-xl font-semibold">Workspace not found</h1>
      <p className="mt-2 text-sm text-zinc-600">
        It may have been removed, or the link is wrong.
      </p>
      <Link href="/" className="mt-4 inline-block text-sm underline">
        Back to workspaces
      </Link>
    </Shell>
  );
}
