import Link from "next/link";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-zinc-50 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="font-semibold tracking-tight">
            EnsureBox
            <span className="ml-2 text-sm font-normal text-zinc-500">
              Operator console
            </span>
          </Link>
          <p className="text-sm text-zinc-500">
            Layer 2 control plane: Docker guests, ports, volumes, lifecycle.
          </p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
