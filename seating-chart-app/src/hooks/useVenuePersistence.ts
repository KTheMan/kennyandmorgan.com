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
import { useVenueQuery, useUpdateVenueMutation } from "./useVenueApi";
import type { VenueData } from "@shared/types/venue";

// Unlike upstream Seating.Art, there's exactly one venue (the wedding),
// no shareable slugs, no PIN-gated edit mode, and no anonymous access —
// AdminGate has already verified an admin session before this hook ever
// runs. This is just: load once, then debounce-save on every change.

const VENUE_CACHE_KEY = "km-seating-chart-venue-cache";

export const DEFAULT_VENUE_DATA: VenueData = {
  shapes: [],
  guests: [],
  eventTitle: "Kenny & Morgan's Wedding",
  tableCounter: 1,
};

// A localStorage warm-load cache so the canvas isn't blank while the
// first server fetch is in flight. The server response is always treated
// as the source of truth once it arrives.
const cache = {
  get(): VenueData | null {
    try {
      const item = localStorage.getItem(VENUE_CACHE_KEY);
      return item ? (JSON.parse(item) as VenueData) : null;
    } catch {
      return null;
    }
  },
  set(data: VenueData): void {
    try {
      localStorage.setItem(VENUE_CACHE_KEY, JSON.stringify(data));
    } catch {
      // Ignore quota errors — this cache is a convenience, not a source of truth.
    }
  },
};

export const useVenuePersistence = (token: string | null) => {
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
  } = useVenueQuery(token);

  const {
    mutate: updateVenueMutate,
    status: updateStatus,
    error: updateError,
  } = useUpdateVenueMutation();

  const isInitialLoadComplete = useRef(false);
  const hasWarmedFromCache = useRef(false);

  // --- Warm-load from localStorage immediately on mount. ---
  useEffect(() => {
    if (hasWarmedFromCache.current) {
      return;
    }
    hasWarmedFromCache.current = true;
    const cached = cache.get();
    if (cached) {
      setShapes(cached.shapes ?? []);
      setGuests(cached.guests ?? []);
      setEventTitle(cached.eventTitle ?? DEFAULT_VENUE_DATA.eventTitle);
      setTableCounter(cached.tableCounter ?? 1);
    }
  }, [setShapes, setGuests, setEventTitle, setTableCounter]);

  // --- Once the server responds, it becomes the source of truth. ---
  useEffect(() => {
    if (!isServerLoadSuccess || !serverData || isInitialLoadComplete.current) {
      return;
    }
    const venueData: VenueData =
      serverData.venue_data && Object.keys(serverData.venue_data).length > 0
        ? serverData.venue_data
        : DEFAULT_VENUE_DATA;

    setShapes(venueData.shapes ?? []);
    setGuests(venueData.guests ?? []);
    setEventTitle(venueData.eventTitle ?? DEFAULT_VENUE_DATA.eventTitle);
    setTableCounter(venueData.tableCounter ?? 1);
    cache.set(venueData);
    isInitialLoadComplete.current = true;
  }, [
    serverData,
    isServerLoadSuccess,
    setShapes,
    setGuests,
    setEventTitle,
    setTableCounter,
  ]);

  // --- Debounced save-back to the worker on every change. ---
  const debouncedServerUpdate = useDebouncedCallback(
    (dataToUpdate: VenueData, activeToken: string) => {
      updateVenueMutate({ token: activeToken, venueData: dataToUpdate });
    },
    2000,
  );

  useEffect(() => {
    if (!isInitialLoadComplete.current || !token) {
      return;
    }
    cache.set(currentVenueData);
    debouncedServerUpdate(currentVenueData, token);
  }, [currentVenueData, token, debouncedServerUpdate]);

  // --- Clear the canvas and start over (same venue, wiped state). ---
  const handleClearVenue = () => {
    setShapes(DEFAULT_VENUE_DATA.shapes);
    setGuests(DEFAULT_VENUE_DATA.guests);
    setEventTitle(DEFAULT_VENUE_DATA.eventTitle);
    setTableCounter(DEFAULT_VENUE_DATA.tableCounter);
  };

  const isLoading =
    !isInitialLoadComplete.current && isLoadingFromServer && !cache.get();
  const isSaving = updateStatus === "pending";

  return {
    isLoading,
    isSaving,
    serverError,
    updateError,
    handleClearVenue,
  };
};
