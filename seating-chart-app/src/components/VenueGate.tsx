import { useCallback, useEffect, useState } from "react";
import { getVenue, validatePin, NotFoundError } from "@/lib/api/venues";
import { tryVerifyAdminSession } from "@/lib/adminAuth";
import { SeatingChartApp } from "@/components/SeatingChartApp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock } from "lucide-react";

export type VenueAccess =
  | { kind: "admin"; token: string }
  | { kind: "editor"; editPin: string; viewPin?: string }
  | { kind: "viewer"; viewPin?: string };

const viewPinStorageKey = (slug: string) => `km-seating-chart-view-pin-${slug}`;
const editPinStorageKey = (slug: string) => `km-seating-chart-edit-pin-${slug}`;

type GateState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "locked"; hasEditPin: boolean; hasViewPin: boolean }
  | {
      status: "ready";
      hasEditPin: boolean;
      hasViewPin: boolean;
      viewPinRequired: boolean;
      access: VenueAccess;
    };

// Resolves who's allowed to do what for a single chart. Two independent
// gates, stacked:
//   Gate A (view): only relevant if the venue's view PIN is turned on —
//     admin, a valid edit PIN, or a valid view PIN all pass it.
//   Gate B (edit): same as before — admin or a valid edit PIN.
// A venue with its view PIN off (the default) skips Gate A entirely, so
// behavior is unchanged from before view PINs existed.
export function VenueGate({
  slug,
  onBackToManager,
}: {
  slug: string;
  onBackToManager: () => void;
}) {
  const [state, setState] = useState<GateState>({ status: "loading" });

  const resolveAccess = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const adminSession = await tryVerifyAdminSession();
      const storedViewPin = localStorage.getItem(viewPinStorageKey(slug));
      const storedEditPin = localStorage.getItem(editPinStorageKey(slug));

      const result = await getVenue(slug, {
        token: adminSession?.token,
        viewPin: storedViewPin,
        editPin: storedEditPin,
      });

      if (result.locked) {
        setState({ status: "locked", hasEditPin: result.hasEditPin, hasViewPin: result.hasViewPin });
        return;
      }

      const base = {
        hasEditPin: result.hasEditPin,
        hasViewPin: result.hasViewPin,
        viewPinRequired: result.viewPinRequired,
      };

      if (adminSession) {
        setState({ status: "ready", ...base, access: { kind: "admin", token: adminSession.token } });
        return;
      }

      if (storedEditPin) {
        const stillValid = await validatePin(slug, "edit", storedEditPin).catch(() => false);
        if (stillValid) {
          setState({
            status: "ready",
            ...base,
            access: { kind: "editor", editPin: storedEditPin, viewPin: storedViewPin ?? undefined },
          });
          return;
        }
        localStorage.removeItem(editPinStorageKey(slug));
      }

      setState({
        status: "ready",
        ...base,
        access: { kind: "viewer", viewPin: storedViewPin ?? undefined },
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        setState({ status: "not-found" });
      } else {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Something went wrong.",
        });
      }
    }
  }, [slug]);

  useEffect(() => {
    resolveAccess();
  }, [resolveAccess]);

  // Gate A: unlocks viewing. A view PIN always works; the edit PIN also
  // works, since editing implies viewing.
  const handleUnlockView = useCallback(
    async (pin: string): Promise<boolean> => {
      const viewOk = await validatePin(slug, "view", pin);
      if (viewOk) {
        localStorage.setItem(viewPinStorageKey(slug), pin);
        await resolveAccess();
        return true;
      }
      const editOk = await validatePin(slug, "edit", pin);
      if (editOk) {
        localStorage.setItem(editPinStorageKey(slug), pin);
        await resolveAccess();
        return true;
      }
      return false;
    },
    [slug, resolveAccess],
  );

  // Gate B: unlocks editing once already viewing.
  const handleUnlockEdit = useCallback(
    async (pin: string): Promise<boolean> => {
      const ok = await validatePin(slug, "edit", pin);
      if (ok) {
        localStorage.setItem(editPinStorageKey(slug), pin);
        setState((prev) =>
          prev.status === "ready"
            ? {
                ...prev,
                access: {
                  kind: "editor",
                  editPin: pin,
                  viewPin: prev.access.kind === "viewer" ? prev.access.viewPin : undefined,
                },
              }
            : prev,
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

  if (state.status === "locked") {
    return <LockedScreen onUnlock={handleUnlockView} onBackToManager={onBackToManager} />;
  }

  return (
    <SeatingChartApp
      slug={slug}
      access={state.access}
      hasEditPin={state.hasEditPin}
      hasViewPin={state.hasViewPin}
      viewPinRequired={state.viewPinRequired}
      onUnlockWithPin={handleUnlockEdit}
      onViewPinChanged={resolveAccess}
      onBackToManager={onBackToManager}
    />
  );
}

function LockedScreen({
  onUnlock,
  onBackToManager,
}: {
  onUnlock: (pin: string) => Promise<boolean>;
  onBackToManager: () => void;
}) {
  const [pin, setPin] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (pin.length !== 4) {
      setError("PIN must be 4 digits.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const ok = await onUnlock(pin);
      if (!ok) {
        setError("Incorrect PIN.");
        setPin("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-background p-8 text-foreground">
      <div className="w-full max-w-xs text-center">
        <Lock size={28} className="mx-auto mb-4 text-primary/70" strokeWidth={1.5} />
        <h1 className="mb-2 text-2xl font-semibold">This chart is private</h1>
        <p className="mb-6 text-muted-foreground">
          Enter its PIN to view it.
        </p>
        <div className="flex items-center gap-1.5">
          <Input
            type="password"
            maxLength={4}
            placeholder="PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && !isSubmitting && handleSubmit()}
            className="h-11 text-center font-mono text-lg tracking-widest"
            disabled={isSubmitting}
            autoFocus
          />
          <Button onClick={handleSubmit} disabled={isSubmitting || pin.length !== 4} className="h-11">
            {isSubmitting ? "…" : "Unlock"}
          </Button>
        </div>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <Button variant="link" onClick={onBackToManager} className="mt-4 text-muted-foreground">
          Back to Seating Charts
        </Button>
      </div>
    </div>
  );
}
