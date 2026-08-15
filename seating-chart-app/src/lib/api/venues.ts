// Talks to the seating-chart-api Supabase Edge Function (the "worker")
// instead of Seating-Planner's original Express server — see
// supabase/functions/seating-chart-api in the main site repo.
//
// Multiple venues, each addressed by a shareable slug:
//   - listVenues / createVenue / setPin require an admin session token.
//   - getVenue never requires anything — viewing a chart is always public.
//   - saveVenue and validatePin take an optional pin instead.

import type { VenueData } from "@shared/types/venue";
import { loadRuntimeConfig } from "@/lib/runtimeConfig";

export class NotFoundError extends Error {}

export interface VenueSummary {
  slug: string;
  eventTitle: string;
  updatedAt: string;
  hasPin: boolean;
}

export interface VenuePayload {
  slug: string;
  venueData: VenueData;
  updatedAt: string | null;
  hasPin: boolean;
}

async function workerFetch(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<Response> {
  const { supabaseUrl, supabaseAnonKey } = await loadRuntimeConfig();
  return fetch(`${supabaseUrl}/functions/v1/seating-chart-api/${path}`, {
    ...init,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { "x-km-session-token": token } : {}),
      ...init.headers,
    },
  });
}

async function parseJsonOrThrow(
  response: Response,
  action: string,
): Promise<Record<string, unknown> | null> {
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

export const listVenues = async (token: string): Promise<VenueSummary[]> => {
  const response = await workerFetch("venues", { method: "GET" }, token);
  const body = await parseJsonOrThrow(response, "Failed to list charts");
  return (body?.venues as VenueSummary[] | undefined) ?? [];
};

export const createVenue = async (
  token: string,
  eventTitle?: string,
): Promise<{ slug: string; pin: string }> => {
  const response = await workerFetch(
    "venues",
    { method: "POST", body: JSON.stringify({ eventTitle }) },
    token,
  );
  const body = await parseJsonOrThrow(response, "Failed to create chart");
  return {
    slug: body?.slug as string,
    pin: body?.pin as string,
  };
};

export const getVenue = async (slug: string): Promise<VenuePayload> => {
  const response = await workerFetch(`venue?slug=${encodeURIComponent(slug)}`, {
    method: "GET",
  });
  if (response.status === 404) {
    throw new NotFoundError(`"${slug}" doesn't match a seating chart.`);
  }
  const body = await parseJsonOrThrow(response, "Failed to fetch chart");
  return {
    slug: body?.slug as string,
    venueData: body?.venueData as VenueData,
    updatedAt: (body?.updatedAt as string | null) ?? null,
    hasPin: Boolean(body?.hasPin),
  };
};

export const saveVenue = async (
  slug: string,
  venueData: VenueData,
  credentials: { token?: string | null; pin?: string | null },
): Promise<{ updatedAt: string | null }> => {
  const response = await workerFetch(
    `venue?slug=${encodeURIComponent(slug)}`,
    {
      method: "PUT",
      body: JSON.stringify({ venueData, pin: credentials.pin || undefined }),
    },
    credentials.token,
  );
  const body = await parseJsonOrThrow(response, "Failed to save chart");
  return { updatedAt: (body?.updatedAt as string | null) ?? null };
};

export const validatePin = async (slug: string, pin: string): Promise<boolean> => {
  const response = await workerFetch(
    `venue/validate-pin?slug=${encodeURIComponent(slug)}`,
    { method: "POST", body: JSON.stringify({ pin }) },
  );
  const body = await parseJsonOrThrow(response, "Failed to check PIN");
  return Boolean(body?.success);
};

export const setPin = async (
  slug: string,
  token: string,
  pin?: string,
): Promise<string> => {
  const response = await workerFetch(
    `venue/set-pin?slug=${encodeURIComponent(slug)}`,
    { method: "POST", body: JSON.stringify({ pin }) },
    token,
  );
  const body = await parseJsonOrThrow(response, "Failed to set PIN");
  return body?.pin as string;
};
