import { useEffect, useState } from "react";
import { listVenues, createVenue, type VenueSummary } from "@/lib/api/venues";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { Plus, ExternalLink, KeyRound } from "lucide-react";

// The admin-only landing page (no ?v= in the URL): lists every chart and
// lets the admin start a new one. Reaching this page at all already
// required AdminGate to verify an admin session.
export function VenueManager({
  token,
  onOpenVenue,
}: {
  token: string;
  onOpenVenue: (slug: string) => void;
}) {
  const [venues, setVenues] = useState<VenueSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const { toast } = useToast();

  const load = async () => {
    setIsLoading(true);
    try {
      setVenues(await listVenues(token));
    } catch (error) {
      toast({
        title: "Could not load charts",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const { slug, pin } = await createVenue(token, newTitle.trim() || undefined);
      toast({
        title: "Chart created",
        description: `Share PIN: ${pin} — write it down now, it won't be shown again unless you regenerate it.`,
      });
      setNewTitle("");
      onOpenVenue(slug);
    } catch (error) {
      toast({
        title: "Could not create chart",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-background p-6 text-foreground sm:p-10">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-1 text-2xl font-semibold">Seating Charts</h1>
        <p className="mb-6 text-muted-foreground">
          Every chart is shareable by link — anyone with the link can view it, and its
          PIN unlocks editing without your admin password.
        </p>

        <div className="mb-8 flex gap-2">
          <Input
            placeholder="New chart name (optional)"
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !isCreating) handleCreate();
            }}
          />
          <Button onClick={handleCreate} disabled={isCreating}>
            <Plus size={16} className="mr-2" />
            {isCreating ? "Creating…" : "New Chart"}
          </Button>
        </div>

        {isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : venues.length === 0 ? (
          <p className="text-muted-foreground">No charts yet — create your first one above.</p>
        ) : (
          <ul className="space-y-2">
            {venues.map((venue) => (
              <li
                key={venue.slug}
                className="flex items-center justify-between rounded-md border border-border p-3"
              >
                <div>
                  <p className="font-medium">{venue.eventTitle}</p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    /{venue.slug} &middot; updated {new Date(venue.updatedAt).toLocaleString()}
                    {venue.hasPin && (
                      <span className="inline-flex items-center gap-0.5" title="PIN-protected">
                        <KeyRound size={12} />
                      </span>
                    )}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => onOpenVenue(venue.slug)}>
                  Open
                  <ExternalLink size={14} className="ml-1.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
