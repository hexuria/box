import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ConnectionStatus } from "@/lib/ensurebox";

export function ConnectionBanner({ status }: { status: ConnectionStatus }) {
  if (status.reachable && status.authorized) {
    return null;
  }

  if (status.reachable && status.authorized === false) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Cannot reach your boxes</AlertTitle>
        <AlertDescription>
          The control plane rejected this client. Check that the client token
          matches EnsureBox.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive">
      <AlertTitle>Cannot reach your boxes</AlertTitle>
      <AlertDescription>{status.message}</AlertDescription>
    </Alert>
  );
}
