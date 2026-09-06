import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ConnectionStatus } from "@/lib/ensurebox";

export function ConnectionBanner({ status }: { status: ConnectionStatus }) {

  if (status.reachable && status.authorized) {
    return (
      <Alert>
        <AlertTitle>Connected to EnsureBox</AlertTitle>
        <AlertDescription>
          {status.url}
          {status.protocol ? ` · protocol ${status.protocol}` : ""}. Shell,
          files, and computer use are routed through this control plane.
        </AlertDescription>
      </Alert>
    );
  }

  if (status.reachable && status.authorized === false) {
    return (
      <Alert variant="destructive">
        <AlertTitle>EnsureBox rejected this client token</AlertTitle>
        <AlertDescription>
          {status.url}. Set <code>ENSUREBOX_TOKEN</code> in <code>l1/.env</code>{" "}
          to the same value L2 uses.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive">
      <AlertTitle>EnsureBox is not reachable</AlertTitle>
      <AlertDescription>
        {status.message} Start L2 with{" "}
        <code>cd ensurebox && npm run dev</code>, then refresh this page.
      </AlertDescription>
    </Alert>
  );
}
