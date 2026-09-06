import { Shell } from "@/components/shell";
import Link from "next/link";

export default function NotFound() {
  return (
    <Shell>
      <h1 className="text-xl font-semibold">Box not found</h1>
      <p className="mt-2 text-sm text-zinc-600">
        It may have been destroyed, or the id is wrong.
      </p>
      <Link href="/" className="mt-4 inline-block text-sm underline">
        Back to boxes
      </Link>
    </Shell>
  );
}
