import { useEffect, useRef } from "react";
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
  token?: string | null;
  pin?: string | null;
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
  } = useVenueQuery(slug);

  const {
    mutate: saveVenueMutate,
    status: updateStatus,
    error: updateError,
  } = useSaveVenueMutation();

  const isInitialLoadComplete = useRef(false);
  const loadedSlugRef = useRef<string | null>(null);

  // --- Warm-load from localStorage immediately when the slug changes. ---
  useEffect(() => {
    isInitialLoadComplete.current = false;
    loadedSlugRef.current = null;
    const cached = cache.get(slug);
    if (cached) {
      setShapes(cached.shapes ?? []);
      setGuests(cached.guests ?? []);
      setEventTitle(cached.eventTitle ?? DEFAULT_VENUE_DATA.eventTitle);
      setTableCounter(cached.tableCounter ?? 1);
    }
  }, [slug, setShapes, setGuests, setEventTitle, setTableCounter]);

  // --- Once the server responds, it becomes the source of truth. ---
  useEffect(() => {
    if (
      !isServerLoadSuccess ||
      !serverData ||
      loadedSlugRef.current === slug
    ) {
      return;
    }
    const venueData: VenueData =
      serverData.venueData && Object.keys(serverData.venueData).length > 0
        ? serverData.venueData
        : DEFAULT_VENUE_DATA;

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
  // entirely for viewers (no admin token, no validated pin) so a
  // read-only visitor never fires failed save requests. ---
  const debouncedServerUpdate = useDebouncedCallback(
    (activeSlug: string, dataToUpdate: VenueData) => {
      saveVenueMutate({ slug: activeSlug, venueData: dataToUpdate, credentials });
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
  };
};
