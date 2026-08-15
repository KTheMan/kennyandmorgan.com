import { useCallback, useEffect, useState } from "react";
import { getVenue, validatePin, NotFoundError } from "@/lib/api/venues";
import { tryVerifyAdminSession } from "@/lib/adminAuth";
import { SeatingChartApp } from "@/components/SeatingChartApp";
import { Button } from "@/components/ui/button";

export type VenueAccess =
  | { kind: "admin"; token: string }
  | { kind: "editor"; pin: string }
  | { kind: "viewer" };

const pinStorageKey = (slug: string) => `km-seating-chart-pin-${slug}`;

type GateState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "ready"; hasPin: boolean; access: VenueAccess };

// Resolves who's allowed to do what for a single chart, then either
// blocks (not found / error) or hands off to SeatingChartApp. Unlike
// AdminGate, this never blocks on its own — viewing a shared chart is
// always allowed; only editing depends on admin/PIN status.
export function VenueGate({
  slug,
  onBackToManager,
}: {
  slug: string;
  onBackToManager: () => void;
}) {
  const [state, setState] = useState<GateState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    (async () => {
      try {
        const [venue, adminSession] = await Promise.all([
          getVenue(slug),
          tryVerifyAdminSession(),
        ]);
        if (cancelled) return;

        if (adminSession) {
          setState({
            status: "ready",
            hasPin: venue.hasPin,
            access: { kind: "admin", token: adminSession.token },
          });
          return;
        }

        const storedPin = venue.hasPin
          ? localStorage.getItem(pinStorageKey(slug))
          : null;
        if (storedPin) {
          const stillValid = await validatePin(slug, storedPin).catch(() => false);
          if (cancelled) return;
          if (stillValid) {
            setState({
              status: "ready",
              hasPin: venue.hasPin,
              access: { kind: "editor", pin: storedPin },
            });
            return;
          }
          localStorage.removeItem(pinStorageKey(slug));
        }

        setState({ status: "ready", hasPin: venue.hasPin, access: { kind: "viewer" } });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof NotFoundError) {
          setState({ status: "not-found" });
        } else {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Something went wrong.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const handleUnlockWithPin = useCallback(
    async (pin: string): Promise<boolean> => {
      const ok = await validatePin(slug, pin);
      if (ok) {
        localStorage.setItem(pinStorageKey(slug), pin);
        setState((prev) =>
          prev.status === "ready" ? { ...prev, access: { kind: "editor", pin } } : prev,
        );
      }
      return ok;
    },
    [slug],
  );

  if (state.status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <p className="text-muted-foreground">Loading chart…</p>
      </div>
    );
  }

  if (state.status === "not-found") {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-8 text-foreground">
        <div className="max-w-md text-center">
          <h1 className="mb-3 text-2xl font-semibold">Chart not found</h1>
          <p className="mb-6 text-muted-foreground">
            That link doesn't match a seating chart.
          </p>
          <Button onClick={onBackToManager}>Back to Seating Charts</Button>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-8 text-foreground">
        <div className="max-w-md text-center">
          <h1 className="mb-3 text-2xl font-semibold">Something went wrong</h1>
          <p className="mb-6 text-muted-foreground">{state.message}</p>
          <Button onClick={onBackToManager}>Back to Seating Charts</Button>
        </div>
      </div>
    );
  }

  return (
    <SeatingChartApp
      slug={slug}
      access={state.access}
      hasPin={state.hasPin}
      onUnlockWithPin={handleUnlockWithPin}
      onBackToManager={onBackToManager}
    />
  );
}
