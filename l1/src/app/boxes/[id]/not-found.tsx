import Link from "next/link";
import { Shell } from "@/components/shell";

export default function NotFound() {
  return (
    <Shell>
      <h1 className="text-xl font-semibold">Box not found</h1>
      <p className="mt-2 text-sm text-zinc-600">
        EnsureBox has no box with that id. It may have been destroyed.
      </p>
      <Link href="/" className="mt-4 inline-block text-sm underline">
        Back to boxes
      </Link>
    </Shell>
  );
}
