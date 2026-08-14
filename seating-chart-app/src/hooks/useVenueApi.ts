import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { getVenue, updateVenue, type VenueResponse } from "@/lib/api/venues";
import type { VenueData } from "@shared/types/venue";

type UpdateVenueVariables = {
  token: string;
  venueData: VenueData;
};

// --- Query Hook ---

/**
 * Fetches the single fixed venue for the wedding. Enabled once an admin
 * session token is available.
 */
export const useVenueQuery = (
  token: string | null,
  options?: Omit<
    UseQueryOptions<VenueResponse, Error, VenueResponse, readonly [string, string | null]>,
    "queryKey" | "queryFn" | "enabled"
  >,
) => {
  return useQuery({
    queryKey: ["seating-chart-venue", token] as const,
    queryFn: () => {
      if (!token) {
        return Promise.reject(new Error("Admin session required."));
      }
      return getVenue(token);
    },
    enabled: !!token,
    ...options,
  });
};

// --- Mutation Hook ---

export const useUpdateVenueMutation = (
  options?: UseMutationOptions<VenueResponse, Error, UpdateVenueVariables>,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token, venueData }) =>
      updateVenue(token, { venue_data: venueData }),
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: ["seating-chart-venue"] });
      options?.onSuccess?.(...args);
    },
    ...options,
  });
};
