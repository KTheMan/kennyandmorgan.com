import { useEffect, useState } from "react";
import { verifyAdminSession, NotAdminError } from "@/lib/adminAuth";
import { Button } from "@/components/ui/button";

type GateState =
  | { status: "checking" }
  | { status: "denied"; message: string }
  | { status: "granted"; token: string };

// The nav link that leads here is already hidden from non-admins on the
// main site, but this is the real gate: the seating chart never renders
// without a verified admin session, and it never has a login form of its
// own — signing in happens on the main site's admin console.
export function AdminGate({
  children,
}: {
  children: (token: string) => React.ReactNode;
}) {
  const [state, setState] = useState<GateState>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;
    verifyAdminSession()
      .then((session) => {
        if (!cancelled) setState({ status: "granted", token: session.token });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof NotAdminError || error instanceof Error
          ? error.message
          : "Sign in required.";
        setState({ status: "denied", message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "checking") {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <p className="text-muted-foreground">Checking admin access…</p>
      </div>
    );
  }

  if (state.status === "denied") {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-8 text-foreground">
        <div className="max-w-md text-center">
          <h1 className="mb-3 text-2xl font-semibold">Admin access required</h1>
          <p className="mb-6 text-muted-foreground">{state.message}</p>
          <Button asChild>
            <a href="../admin.html">Go to Admin Console</a>
          </Button>
        </div>
      </div>
    );
  }

  return <>{children(state.token)}</>;
}
