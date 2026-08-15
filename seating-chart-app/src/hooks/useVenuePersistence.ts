import { useEffect, useRef, useState } from "react";
import { useAtom, useSetAtom } from "jotai";
import { useDebouncedCallback } from "use-debounce";

import {
  venueDataAtom,
  baseShapesAtom,
  guestsAtom,
  eventTitleAtom,
  tableCounterAtom,
} from "@/lib/atoms";
import { useVenueQuery, useSaveVenueMutation } from "./useVenueApi";
import type { VenueData } from "@shared/types/venue";

export const DEFAULT_VENUE_DATA: VenueData = {
  shapes: [],
  guests: [],
  eventTitle: "New Event",
  tableCounter: 1,
};

// A localStorage warm-load cache (per slug) so the canvas isn't blank
// while the first fetch is in flight. The server response is always
// treated as the source of truth once it arrives.
const cacheKey = (slug: string) => `km-seating-chart-venue-cache-${slug}`;

const cache = {
  get(slug: string): VenueData | null {
    try {
      const item = localStorage.getItem(cacheKey(slug));
      return item ? (JSON.parse(item) as VenueData) : null;
    } catch {
      return null;
    }
  },
  set(slug: string, data: VenueData): void {
    try {
      localStorage.setItem(cacheKey(slug), JSON.stringify(data));
    } catch {
      // Ignore quota errors — this cache is a convenience, not a source of truth.
    }
  },
};

export interface VenueCredentials {
  // All three are passed through to every fetch/save call regardless of
  // which one is actually "the" credential for this visitor — harmless
  // if irrelevant, and it's what lets a re-fetch skip the view-PIN gate
  // a visitor already got past once (see VenueGate).
  token?: string | null;
  viewPin?: string | null;
  editPin?: string | null;
}

export const useVenuePersistence = (
  slug: string,
  credentials: VenueCredentials,
  canEdit: boolean,
) => {
  const [currentVenueData] = useAtom(venueDataAtom);
  const setShapes = useSetAtom(baseShapesAtom);
  const setGuests = useSetAtom(guestsAtom);
  const setEventTitle = useSetAtom(eventTitleAtom);
  const setTableCounter = useSetAtom(tableCounterAtom);

  const {
    data: serverData,
    isLoading: isLoadingFromServer,
    error: serverError,
    isSuccess: isServerLoadSuccess,
  } = useVenueQuery(slug, credentials);

  const {
    mutate: saveVenueMutate,
    status: updateStatus,
    error: updateError,
  } = useSaveVenueMutation();

  const isInitialLoadComplete = useRef(false);
  const loadedSlugRef = useRef<string | null>(null);
  const [loadIssue, setLoadIssue] = useState<Error | null>(null);

  // --- Warm-load from localStorage immediately when the slug changes. ---
  useEffect(() => {
    isInitialLoadComplete.current = false;
    loadedSlugRef.current = null;
    setLoadIssue(null);
    const cached = cache.get(slug);
    if (cached) {
      setShapes(cached.shapes ?? []);
      setGuests(cached.guests ?? []);
      setEventTitle(cached.eventTitle ?? DEFAULT_VENUE_DATA.eventTitle);
      setTableCounter(cached.tableCounter ?? 1);
    }
  }, [slug, setShapes, setGuests, setEventTitle, setTableCounter]);

  // --- Once the server responds, it becomes the source of truth. ---
  // (VenueGate never renders this hook's owner, SeatingChartApp, unless
  // the venue is already unlocked, but the fetch here is a fresh
  // request — serverData.locked can't actually be true in practice as
  // long as `credentials` still matches what got us past the gate.)
  useEffect(() => {
    if (!isServerLoadSuccess || !serverData) return;
    if (loadedSlugRef.current === slug) return;
    if (serverData.locked === true) return;

    const venueData = serverData.venueData;
    // seating_chart_create_venue always seeds shapes/guests as [] (never
    // absent), so a real venue's response should never fail this check —
    // it only trips on an actual fetch/response problem. Treating that as
    // "must be a brand new venue, start fresh" used to substitute an
    // empty DEFAULT_VENUE_DATA *and* immediately mark the load complete,
    // which enables the debounced autosave — silently overwriting the
    // server's real data (tables, seating assignments, the whole guest
    // list) with an empty canvas within seconds, with nothing to undo it
    // (seating_chart_save_venue has no server-side check preventing an
    // authorized save from blanking existing data). Treat it as a load
    // error instead: leave everything untouched and never enable
    // autosave until a response actually looks right.
    const looksValid =
      venueData &&
      typeof venueData === "object" &&
      Array.isArray(venueData.shapes) &&
      Array.isArray(venueData.guests);

    if (!looksValid) {
      setLoadIssue(
        new Error(
          "The chart data that came back looks incomplete. Refresh to try again — nothing has been changed or saved.",
        ),
      );
      return;
    }

    setLoadIssue(null);
    setShapes(venueData.shapes ?? []);
    setGuests(venueData.guests ?? []);
    setEventTitle(venueData.eventTitle ?? DEFAULT_VENUE_DATA.eventTitle);
    setTableCounter(venueData.tableCounter ?? 1);
    cache.set(slug, venueData);
    isInitialLoadComplete.current = true;
    loadedSlugRef.current = slug;
  }, [
    slug,
    serverData,
    isServerLoadSuccess,
    setShapes,
    setGuests,
    setEventTitle,
    setTableCounter,
  ]);

  // --- Debounced save-back to the worker on every change. Skipped
  // entirely for viewers (no admin token, no validated edit PIN) so a
  // read-only visitor never fires failed save requests. ---
  const debouncedServerUpdate = useDebouncedCallback(
    (activeSlug: string, dataToUpdate: VenueData) => {
      saveVenueMutate({
        slug: activeSlug,
        venueData: dataToUpdate,
        credentials: { token: credentials.token, editPin: credentials.editPin },
      });
    },
    2000,
  );

  useEffect(() => {
    if (!isInitialLoadComplete.current || loadedSlugRef.current !== slug || !canEdit) {
      return;
    }
    cache.set(slug, currentVenueData);
    debouncedServerUpdate(slug, currentVenueData);
  }, [currentVenueData, slug, canEdit, debouncedServerUpdate]);

  const isLoading =
    !isInitialLoadComplete.current && isLoadingFromServer && !cache.get(slug);
  const isSaving = updateStatus === "pending";

  return {
    isLoading,
    isSaving,
    serverError,
    updateError,
    loadIssue,
  };
};
