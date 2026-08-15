// The connector: pulls accepted guests, grouped by party/group, from the
// wedding site's guest list via the seating-chart-api worker — so the
// seating chart never touches the `guests` table (or the site's admin
// auth) directly. Read-only; nothing here writes back to the guest list.

import { loadRuntimeConfig } from "@/lib/runtimeConfig";

export interface AcceptedGuest {
  weddingGuestId: string;
  fullName: string;
  isPrimary: boolean;
  isPlusOne: boolean;
  isChild: boolean;
  mealChoice: string | null;
  dietaryNotes: string | null;
}

export interface AcceptedGuestParty {
  groupId: string;
  guests: AcceptedGuest[];
}

export const fetchAcceptedGuestParties = async (
  token: string,
): Promise<AcceptedGuestParty[]> => {
  const { supabaseUrl, supabaseAnonKey } = await loadRuntimeConfig();
  const response = await fetch(
    `${supabaseUrl}/functions/v1/seating-chart-api/guests`,
    {
      method: "GET",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        "x-km-session-token": token,
      },
    },
  );

  let body: Record<string, unknown> | null = null;
  try {
    body = await response.json();
  } catch {
    // no body / not JSON
  }

  if (!response.ok || body?.success === false) {
    const message = (body?.error as string | undefined) ||
      `Failed to load accepted guests: ${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return (body?.parties as AcceptedGuestParty[] | undefined) ?? [];
};
