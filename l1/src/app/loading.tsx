import { Shell } from "@/components/shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <Shell>
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </Shell>
  );
}
