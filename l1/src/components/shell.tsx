import Link from "next/link";
import { logoutAction } from "@/lib/actions";
import { Button } from "@/components/ui/button";

export function Shell({
  children,
  authed = false,
}: {
  children: React.ReactNode;
  authed?: boolean;
}) {
  return (
    <div className="min-h-full bg-zinc-50 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="font-semibold tracking-tight">
            Grok Box
            <span className="ml-2 text-sm font-normal text-zinc-500">
              Client
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <p className="text-sm text-zinc-500">
              Shell, files, and desktop. Use a box — do not operate Docker here.
            </p>
            {authed ? (
              <form action={logoutAction}>
                <Button type="submit" variant="outline" size="sm">
                  Sign out
                </Button>
              </form>
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
