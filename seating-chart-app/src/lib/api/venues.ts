// Talks to the seating-chart-api Supabase Edge Function (the "worker")
// instead of Seating-Planner's original Express server — see
// supabase/functions/seating-chart-api in the main site repo. There is a
// single fixed venue for the wedding, so unlike the upstream project
// there's no slug/create-venue flow here.

import type { VenueData } from "@shared/types/venue";
import { loadRuntimeConfig } from "@/lib/runtimeConfig";

export interface UpdateVenuePayload {
  venue_data: VenueData;
}

export interface VenueResponse {
  venue_data: VenueData;
  updated_at: string | null;
}

async function workerFetch(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  const { supabaseUrl, supabaseAnonKey } = await loadRuntimeConfig();
  const response = await fetch(
    `${supabaseUrl}/functions/v1/seating-chart-api/${path}`,
    {
      ...init,
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        "x-km-session-token": token,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    },
  );
  return response;
}

async function parseJsonOrThrow(response: Response, action: string) {
  let body: Record<string, unknown> | null = null;
  try {
    body = await response.json();
  } catch {
    // no body / not JSON
  }
  if (!response.ok || body?.success === false) {
    const message = (body?.error as string | undefined) ||
      `${action} failed: ${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return body;
}

/**
 * Fetches the (single, fixed) venue for the wedding.
 */
export const getVenue = async (token: string): Promise<VenueResponse> => {
  const response = await workerFetch("venue", token, { method: "GET" });
  const body = await parseJsonOrThrow(response, "Failed to fetch venue");
  return {
    venue_data: body?.venueData as VenueData,
    updated_at: (body?.updatedAt as string | null) ?? null,
  };
};

/**
 * Persists the venue's current state (shapes, guests, event title, etc.).
 */
export const updateVenue = async (
  token: string,
  data: UpdateVenuePayload,
): Promise<VenueResponse> => {
  const response = await workerFetch("venue", token, {
    method: "PUT",
    body: JSON.stringify({ venueData: data.venue_data }),
  });
  const body = await parseJsonOrThrow(response, "Failed to save venue");
  return {
    venue_data: data.venue_data,
    updated_at: (body?.updatedAt as string | null) ?? null,
  };
};
