// seating-chart-api
//
// Backend "worker" for our hard fork of gabriel1ll7/Seating-Planner
// ("Seating.Art"). We don't run their Express + PostgreSQL stack — this
// Deno edge function replaces it with three small routes backed by our
// existing Supabase project, so the forked frontend can be published as
// static assets alongside the rest of the wedding site.
//
// Every route requires an admin session token (the same one issued by
// public.login_access / stored as km_access_token on the main site) sent
// via the `x-km-session-token` header. Authorization is delegated to the
// existing public.require_session(session_token, 'admin') RPC — this
// function never re-implements session hashing/expiry logic.
//
// Routes:
//   GET  /seating-chart-api/venue   -> { success, venueData, updatedAt }
//   PUT  /seating-chart-api/venue   -> body { venueData }, upsert
//   GET  /seating-chart-api/guests  -> the connector: accepted guests
//                                       grouped by party/group, ready to
//                                       import into the seating chart.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-km-session-token",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
};

const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

// Single fixed venue — this is a private, single-event tool, not the
// original app's multi-tenant/shareable-slug model.
const VENUE_SLUG = Deno.env.get("SEATING_CHART_VENUE_SLUG") ||
  "kenny-and-morgan";

const DEFAULT_VENUE_DATA = {
  shapes: [],
  guests: [],
  eventTitle: "Kenny & Morgan's Wedding",
  tableCounter: 1,
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface GuestRow {
  id: number;
  full_name: string;
  group_id: string;
  is_primary: boolean;
  is_child: boolean;
  meal_choice: string | null;
  dietary_notes: string | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function getEnvConfig(): { supabaseUrl: string; serviceRoleKey: string } {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new HttpError(500, "Supabase environment not configured.");
  }
  return { supabaseUrl, serviceRoleKey };
}

function serviceHeaders(serviceRoleKey: string): Record<string, string> {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
}

// Delegates auth to the site's existing require_session RPC rather than
// re-implementing token hashing/expiry/level checks here.
async function requireAdminSession(
  supabaseUrl: string,
  serviceRoleKey: string,
  sessionToken: string | null,
): Promise<void> {
  if (!sessionToken) {
    throw new HttpError(401, "Missing session token.");
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/rpc/require_session`,
    {
      method: "POST",
      headers: serviceHeaders(serviceRoleKey),
      body: JSON.stringify({
        session_token: sessionToken,
        required_level: "admin",
      }),
    },
  );

  if (!response.ok) {
    throw new HttpError(401, "Admin session required.");
  }
}

async function fetchVenue(
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<{ venueData: unknown; updatedAt: string | null }> {
  const params = new URLSearchParams({
    slug: `eq.${VENUE_SLUG}`,
    select: "venue_data,updated_at",
    limit: "1",
  });
  const response = await fetch(
    `${supabaseUrl}/rest/v1/seating_chart_venues?${params.toString()}`,
    { headers: serviceHeaders(serviceRoleKey) },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new HttpError(502, `Failed to load venue: ${text}`);
  }
  const rows = await response.json() as Array<
    { venue_data: unknown; updated_at: string }
  >;
  if (rows.length === 0) {
    return { venueData: DEFAULT_VENUE_DATA, updatedAt: null };
  }
  return { venueData: rows[0].venue_data, updatedAt: rows[0].updated_at };
}

async function saveVenue(
  supabaseUrl: string,
  serviceRoleKey: string,
  venueData: unknown,
): Promise<{ updatedAt: string | null }> {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/seating_chart_venues?on_conflict=slug`,
    {
      method: "POST",
      headers: {
        ...serviceHeaders(serviceRoleKey),
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify([{ slug: VENUE_SLUG, venue_data: venueData }]),
    },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new HttpError(502, `Failed to save venue: ${text}`);
  }
  const rows = await response.json() as Array<{ updated_at: string }>;
  return { updatedAt: rows[0]?.updated_at ?? null };
}

// The connector: accepted guests, grouped by party/group_id, shaped for
// import into the seating chart's guest list.
async function fetchAcceptedGuestParties(
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<
  Array<{
    groupId: string;
    guests: Array<{
      weddingGuestId: string;
      fullName: string;
      isPrimary: boolean;
      isChild: boolean;
      mealChoice: string | null;
      dietaryNotes: string | null;
    }>;
  }>
> {
  const params = new URLSearchParams({
    rsvp_status: "eq.accepted",
    select: "id,full_name,group_id,is_primary,is_child,meal_choice,dietary_notes",
    order: "group_id.asc,is_primary.desc,full_name.asc",
  });
  const response = await fetch(
    `${supabaseUrl}/rest/v1/guests?${params.toString()}`,
    { headers: serviceHeaders(serviceRoleKey) },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new HttpError(502, `Failed to load accepted guests: ${text}`);
  }
  const rows = await response.json() as GuestRow[];

  const partiesByGroup = new Map<string, {
    groupId: string;
    guests: Array<{
      weddingGuestId: string;
      fullName: string;
      isPrimary: boolean;
      isChild: boolean;
      mealChoice: string | null;
      dietaryNotes: string | null;
    }>;
  }>();

  for (const row of rows) {
    const groupId = row.group_id || "unknown";
    if (!partiesByGroup.has(groupId)) {
      partiesByGroup.set(groupId, { groupId, guests: [] });
    }
    partiesByGroup.get(groupId)!.guests.push({
      weddingGuestId: String(row.id),
      fullName: row.full_name,
      isPrimary: Boolean(row.is_primary),
      isChild: Boolean(row.is_child),
      mealChoice: row.meal_choice,
      dietaryNotes: row.dietary_notes,
    });
  }

  return Array.from(partiesByGroup.values());
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // Supabase serves this function at /functions/v1/seating-chart-api/*;
  // pull off everything after the function name so this works whether
  // it's invoked via the platform gateway or a local `functions serve`.
  const segments = url.pathname.split("/").filter(Boolean);
  const functionNameIndex = segments.indexOf("seating-chart-api");
  const route = functionNameIndex === -1
    ? segments.at(-1) ?? ""
    : segments.slice(functionNameIndex + 1).join("/");

  const { supabaseUrl, serviceRoleKey } = getEnvConfig();
  const sessionToken = req.headers.get("x-km-session-token");
  await requireAdminSession(supabaseUrl, serviceRoleKey, sessionToken);

  if (route === "venue" && req.method === "GET") {
    const { venueData, updatedAt } = await fetchVenue(
      supabaseUrl,
      serviceRoleKey,
    );
    return jsonResponse({ success: true, venueData, updatedAt });
  }

  if (route === "venue" && req.method === "PUT") {
    const body = await req.json().catch(() => null) as
      | { venueData?: unknown }
      | null;
    if (!body || typeof body.venueData === "undefined") {
      throw new HttpError(400, "venueData is required.");
    }
    const { updatedAt } = await saveVenue(
      supabaseUrl,
      serviceRoleKey,
      body.venueData,
    );
    return jsonResponse({ success: true, updatedAt });
  }

  if (route === "guests" && req.method === "GET") {
    const parties = await fetchAcceptedGuestParties(
      supabaseUrl,
      serviceRoleKey,
    );
    return jsonResponse({
      success: true,
      parties,
      generatedAt: new Date().toISOString(),
    });
  }

  throw new HttpError(404, "Not found.");
}

if (import.meta.main) {
  Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: CORS_HEADERS });
    }

    try {
      return await handleRequest(req);
    } catch (err) {
      if (err instanceof HttpError) {
        return jsonResponse(
          { success: false, error: err.message },
          err.status,
        );
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[seating-chart-api]", message);
      return jsonResponse({ success: false, error: message }, 500);
    }
  });
}
