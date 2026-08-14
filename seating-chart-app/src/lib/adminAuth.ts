// Admin session check, reusing the main wedding site's login instead of
// this app having (or needing) any auth of its own.
//
// The main site stores its session token in localStorage under
// "km_access_token" after a successful admin login (see data-client.js /
// admin.js). Because this app is served same-origin under
// /seating-chart/, that localStorage entry is already visible here — we
// just verify it against the existing get_access_session RPC.

import { loadRuntimeConfig } from "./runtimeConfig";

const ACCESS_TOKEN_KEY = "km_access_token";

export interface AdminSession {
  token: string;
  accessLevel: string;
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

export class NotAdminError extends Error {}

/**
 * Verifies the stored session token grants admin access. Throws if there
 * is no token, the token is invalid/expired, or it's below admin level.
 */
export async function verifyAdminSession(): Promise<AdminSession> {
  const token = getStoredToken();
  if (!token) {
    throw new NotAdminError("Sign in required.");
  }

  const { supabaseUrl, supabaseAnonKey } = await loadRuntimeConfig();
  const response = await fetch(
    `${supabaseUrl}/rest/v1/rpc/get_access_session`,
    {
      method: "POST",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ session_token: token }),
    },
  );

  if (!response.ok) {
    throw new NotAdminError("Your session has expired. Please sign in again.");
  }

  const data = await response.json();
  if (data?.accessLevel !== "admin") {
    throw new NotAdminError(
      "That session isn't at admin level. Sign in with the admin password.",
    );
  }

  return { token, accessLevel: data.accessLevel };
}
