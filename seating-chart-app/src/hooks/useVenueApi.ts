import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { getVenue, saveVenue, type VenueFetchResult } from "@/lib/api/venues";
import type { VenueData } from "@shared/types/venue";

type SaveVenueVariables = {
  slug: string;
  venueData: VenueData;
  credentials: { token?: string | null; editPin?: string | null };
};

// --- Query Hook ---

/**
 * Fetches a venue by slug. Always public to call — the result itself
 * says whether it's locked behind a view PIN (see VenueFetchResult).
 */
export const useVenueQuery = (
  slug: string | null,
  credentials: { token?: string | null; viewPin?: string | null; editPin?: string | null } = {},
  options?: Omit<
    UseQueryOptions<VenueFetchResult, Error, VenueFetchResult, readonly [string, string | null, string | null, string | null, string | null]>,
    "queryKey" | "queryFn" | "enabled"
  >,
) => {
  return useQuery({
    queryKey: [
      "seating-chart-venue",
      slug,
      credentials.token ?? null,
      credentials.viewPin ?? null,
      credentials.editPin ?? null,
    ] as const,
    queryFn: () => {
      if (!slug) {
        return Promise.reject(new Error("A chart slug is required."));
      }
      return getVenue(slug, credentials);
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
