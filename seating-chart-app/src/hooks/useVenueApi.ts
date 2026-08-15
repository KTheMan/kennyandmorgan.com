import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { getVenue, saveVenue, type VenuePayload } from "@/lib/api/venues";
import type { VenueData } from "@shared/types/venue";

type SaveVenueVariables = {
  slug: string;
  venueData: VenueData;
  credentials: { token?: string | null; pin?: string | null };
};

// --- Query Hook ---

/**
 * Fetches a venue by slug. Viewing is always public — no credentials
 * needed — so this is enabled whenever a slug is present.
 */
export const useVenueQuery = (
  slug: string | null,
  options?: Omit<
    UseQueryOptions<VenuePayload, Error, VenuePayload, readonly [string, string | null]>,
    "queryKey" | "queryFn" | "enabled"
  >,
) => {
  return useQuery({
    queryKey: ["seating-chart-venue", slug] as const,
    queryFn: () => {
      if (!slug) {
        return Promise.reject(new Error("A chart slug is required."));
      }
      return getVenue(slug);
    },
    enabled: !!slug,
    ...options,
  });
};

// --- Mutation Hook ---

export const useSaveVenueMutation = (
  options?: UseMutationOptions<{ updatedAt: string | null }, Error, SaveVenueVariables>,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ slug, venueData, credentials }) =>
      saveVenue(slug, venueData, credentials),
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: ["seating-chart-venue"] });
      options?.onSuccess?.(...args);
    },
    ...options,
  });
};
