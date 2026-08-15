// Talks to the seating-chart-api Supabase Edge Function (the "worker")
// instead of Seating-Planner's original Express server — see
// supabase/functions/seating-chart-api in the main site repo.
//
// Multiple venues, each addressed by a shareable slug, with two
// independent PINs:
//   - listVenues / createVenue / setEditPin / setViewPin require an
//     admin session token.
//   - getVenue never requires anything by default — viewing a chart is
//     public unless the admin has turned on that venue's view PIN, in
//     which case it returns a "locked" result instead of throwing.
//   - saveVenue and validatePin take an edit/view pin instead of a token.

import type { VenueData } from "@shared/types/venue";
import { loadRuntimeConfig } from "@/lib/runtimeConfig";

export class NotFoundError extends Error {}

export interface VenueSummary {
  slug: string;
  eventTitle: string;
  updatedAt: string;
  hasEditPin: boolean;
  hasViewPin: boolean;
  viewPinRequired: boolean;
}

export type VenueFetchResult =
  | {
      locked: false;
      slug: string;
      venueData: VenueData;
      updatedAt: string | null;
      hasEditPin: boolean;
      hasViewPin: boolean;
      viewPinRequired: boolean;
    }
  | {
      locked: true;
      slug: string;
      viewPinRequired: true;
      hasEditPin: boolean;
      hasViewPin: boolean;
    };

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

export const getVenue = async (
  slug: string,
  credentials: { token?: string | null; viewPin?: string | null; editPin?: string | null } = {},
): Promise<VenueFetchResult> => {
  const params = new URLSearchParams({ slug });
  if (credentials.viewPin) params.set("viewPin", credentials.viewPin);
  if (credentials.editPin) params.set("editPin", credentials.editPin);

  const response = await workerFetch(
    `venue?${params.toString()}`,
    { method: "GET" },
    credentials.token,
  );
  if (response.status === 404) {
    throw new NotFoundError(`"${slug}" doesn't match a seating chart.`);
  }
  const body = await parseJsonOrThrow(response, "Failed to fetch chart");
  if (body?.locked) {
    return {
      locked: true,
      slug: body.slug as string,
      viewPinRequired: true,
      hasEditPin: Boolean(body.hasEditPin),
      hasViewPin: Boolean(body.hasViewPin),
    };
  }
  return {
    locked: false,
    slug: body?.slug as string,
    venueData: body?.venueData as VenueData,
    updatedAt: (body?.updatedAt as string | null) ?? null,
    hasEditPin: Boolean(body?.hasEditPin),
    hasViewPin: Boolean(body?.hasViewPin),
    viewPinRequired: Boolean(body?.viewPinRequired),
  };
};

export const saveVenue = async (
  slug: string,
  venueData: VenueData,
  credentials: { token?: string | null; editPin?: string | null },
): Promise<{ updatedAt: string | null }> => {
  const response = await workerFetch(
    `venue?slug=${encodeURIComponent(slug)}`,
    {
      method: "PUT",
      body: JSON.stringify({ venueData, editPin: credentials.editPin || undefined }),
    },
    credentials.token,
  );
  const body = await parseJsonOrThrow(response, "Failed to save chart");
  return { updatedAt: (body?.updatedAt as string | null) ?? null };
};

export const validatePin = async (
  slug: string,
  kind: "view" | "edit",
  pin: string,
): Promise<boolean> => {
  const response = await workerFetch(
    `venue/validate-pin?slug=${encodeURIComponent(slug)}`,
    { method: "POST", body: JSON.stringify({ pin, kind }) },
  );
  const body = await parseJsonOrThrow(response, "Failed to check PIN");
  return Boolean(body?.success);
};

export const setEditPin = async (
  slug: string,
  token: string,
  pin?: string,
): Promise<string> => {
  const response = await workerFetch(
    `venue/set-edit-pin?slug=${encodeURIComponent(slug)}`,
    { method: "POST", body: JSON.stringify({ pin }) },
    token,
  );
  const body = await parseJsonOrThrow(response, "Failed to set edit PIN");
  return body?.pin as string;
};

export const setViewPin = async (
  slug: string,
  token: string,
  enabled: boolean,
  pin?: string,
): Promise<string | null> => {
  const response = await workerFetch(
    `venue/set-view-pin?slug=${encodeURIComponent(slug)}`,
    { method: "POST", body: JSON.stringify({ enabled, pin }) },
    token,
  );
  const body = await parseJsonOrThrow(response, "Failed to update view PIN");
  return (body?.pin as string | null) ?? null;
};
