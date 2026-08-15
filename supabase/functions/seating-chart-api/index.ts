// seating-chart-api
//
// Backend "worker" for our hard fork of gabriel1ll7/Seating-Planner
// ("Seating.Art"). We don't run their Express + PostgreSQL stack — this
// Deno edge function replaces it with routes backed by our existing
// Supabase project, so the forked frontend can be published as static
// assets alongside the rest of the wedding site.
//
// Multiple venues, each with a shareable slug and two independent PINs:
//   - Admin (site's existing admin session, sent as x-km-session-token):
//     full access to every venue — list, create, edit, regenerate either
//     PIN, toggle whether viewing needs one at all.
//   - Edit PIN: always on. Anyone with the link + this PIN can edit —
//     editing always implies viewing too.
//   - View PIN: off by default (anyone with the link can view). The
//     admin can toggle it on per-venue to also require a PIN just to see
//     the chart — useful if a venue's guest list is sensitive.
//
// All the actual auth/hashing/rate-limiting logic lives in Postgres RPCs
// (see supabase/migrations/20260816090000_seating_chart_view_edit_pins.sql)
// so this function never re-implements session or PIN comparison itself.
// Those RPCs are NOT granted to anon/authenticated — only this function's
// service-role client can call them, which is what keeps PIN attempts
// funneled through the rate limiter instead of reachable directly via
// PostgREST.
//
// Routes:
//   GET  /seating-chart-api/venues                    -> admin: list venues
//   POST /seating-chart-api/venues                     -> admin: create venue
//   GET  /seating-chart-api/venue?slug=X[&viewPin=&editPin=]
//        -> public: fetch venue, or a locked payload if a view PIN is
//           required and neither admin/editPin/viewPin satisfies it
//   PUT  /seating-chart-api/venue?slug=X                -> admin token OR editPin: save
//   POST /seating-chart-api/venue/validate-pin?slug=X   -> public: check a view or edit PIN
//   POST /seating-chart-api/venue/set-edit-pin?slug=X   -> admin: (re)set the edit PIN
//   POST /seating-chart-api/venue/set-view-pin?slug=X   -> admin: toggle + (re)set the view PIN
//   GET  /seating-chart-api/guests                      -> admin: the connector

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-km-session-token",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
};

const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

const MAX_SLUG_RETRIES = 5;

const ANIMALS = [
  "dog", "cat", "horse", "rabbit", "mouse", "fox", "wolf", "bear", "deer",
  "lion", "tiger", "zebra", "giraffe", "elephant", "monkey", "panda",
  "koala", "kangaroo", "eagle", "hawk", "owl", "robin", "sparrow", "duck",
  "goose", "swan", "penguin", "turtle", "otter", "raccoon", "squirrel",
];
const FURNITURE = [
  "chair", "table", "desk", "sofa", "couch", "ottoman", "stool", "bench",
  "dresser", "nightstand", "wardrobe", "bookcase", "shelf", "cabinet",
  "console", "vanity", "lamp", "chandelier", "rug", "recliner", "rocker",
  "hammock", "chaise", "barstool", "counter", "island", "trunk", "chest",
];

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
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

function clientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  return req.headers.get("x-real-ip") || "unknown";
}

function generateSlug(): string {
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const item = FURNITURE[Math.floor(Math.random() * FURNITURE.length)];
  const number = Math.floor(100 + Math.random() * 900);
  return `${animal}-${item}-${number}`;
}

async function callRpc(
  supabaseUrl: string,
  serviceRoleKey: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: unknown; text: string }> {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: serviceHeaders(serviceRoleKey),
    body: JSON.stringify(args),
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body; leave as null, `text` still has the raw response
  }
  return { ok: response.ok, status: response.status, body, text };
}

function rpcErrorMessage(result: { body: unknown; text: string }): string {
  const body = result.body as Record<string, unknown> | null;
  return (body?.message as string | undefined) || result.text || "Request failed.";
}

async function tryVerifyAdmin(
  supabaseUrl: string,
  serviceRoleKey: string,
  sessionToken: string | null,
): Promise<boolean> {
  if (!sessionToken) return false;
  const result = await callRpc(supabaseUrl, serviceRoleKey, "require_session", {
    session_token: sessionToken,
    required_level: "admin",
  });
  return result.ok;
}

async function requireAdminSession(
  supabaseUrl: string,
  serviceRoleKey: string,
  sessionToken: string | null,
): Promise<void> {
  const ok = await tryVerifyAdmin(supabaseUrl, serviceRoleKey, sessionToken);
  if (!ok) {
    throw new HttpError(401, "Admin session required.");
  }
}

async function listVenues(
  supabaseUrl: string,
  serviceRoleKey: string,
  sessionToken: string | null,
) {
  await requireAdminSession(supabaseUrl, serviceRoleKey, sessionToken);
  const result = await callRpc(supabaseUrl, serviceRoleKey, "seating_chart_list_venues", {
    session_token: sessionToken,
  });
  if (!result.ok) {
    throw new HttpError(result.status, rpcErrorMessage(result));
  }
  return jsonResponse({ success: true, venues: result.body });
}

async function createVenue(
  supabaseUrl: string,
  serviceRoleKey: string,
  sessionToken: string | null,
  eventTitle: string | undefined,
) {
  await requireAdminSession(supabaseUrl, serviceRoleKey, sessionToken);

  let lastResult: Awaited<ReturnType<typeof callRpc>> | null = null;
  for (let attempt = 0; attempt < MAX_SLUG_RETRIES; attempt += 1) {
    const slug = generateSlug();
    const result = await callRpc(supabaseUrl, serviceRoleKey, "seating_chart_create_venue", {
      session_token: sessionToken,
      slug,
      event_title: eventTitle || "New Event",
    });
    if (result.ok) {
      return jsonResponse({ success: true, ...(result.body as Record<string, unknown>) });
    }
    lastResult = result;
    const isCollision = result.text.includes("23505") ||
      result.text.toLowerCase().includes("duplicate key");
    if (!isCollision) {
      throw new HttpError(result.status, rpcErrorMessage(result));
    }
  }
  throw new HttpError(
    500,
    `Could not generate a unique slug after ${MAX_SLUG_RETRIES} attempts: ${
      lastResult ? rpcErrorMessage(lastResult) : "unknown error"
    }`,
  );
}

async function getVenue(
  supabaseUrl: string,
  serviceRoleKey: string,
  slug: string,
  sessionToken: string | null,
  viewPin: string | null,
  editPin: string | null,
  ip: string,
) {
  const result = await callRpc(supabaseUrl, serviceRoleKey, "seating_chart_get_venue", {
    target_slug: slug,
    session_token: sessionToken,
    view_pin: viewPin,
    edit_pin: editPin,
    client_ip: ip,
  });
  if (!result.ok) {
    throw new HttpError(result.status, rpcErrorMessage(result));
  }
  if (!result.body) {
    throw new HttpError(404, "Chart not found.");
  }
  // result.body is either { locked: true, viewPinRequired, hasEditPin,
  // hasViewPin } or { locked: false, venueData, updatedAt, ... } — pass
  // through either way, the frontend branches on `locked`.
  return jsonResponse({ success: true, ...(result.body as Record<string, unknown>) });
}

async function saveVenue(
  supabaseUrl: string,
  serviceRoleKey: string,
  slug: string,
  sessionToken: string | null,
  venueData: unknown,
  editPin: string | undefined,
  ip: string,
) {
  const result = await callRpc(supabaseUrl, serviceRoleKey, "seating_chart_save_venue", {
    session_token: sessionToken,
    target_slug: slug,
    new_venue_data: venueData,
    candidate_edit_pin: editPin || null,
    client_ip: ip,
  });
  if (!result.ok) {
    throw new HttpError(result.status, rpcErrorMessage(result));
  }
  return jsonResponse({ success: true, ...(result.body as Record<string, unknown>) });
}

async function validatePin(
  supabaseUrl: string,
  serviceRoleKey: string,
  slug: string,
  kind: "view" | "edit",
  pin: string,
  ip: string,
) {
  const result = await callRpc(supabaseUrl, serviceRoleKey, "seating_chart_validate_pin", {
    target_slug: slug,
    pin_kind: kind,
    candidate_pin: pin,
    client_ip: ip,
  });
  if (!result.ok) {
    throw new HttpError(result.status, rpcErrorMessage(result));
  }
  return jsonResponse(result.body);
}

async function setEditPin(
  supabaseUrl: string,
  serviceRoleKey: string,
  slug: string,
  sessionToken: string | null,
  pin: string | undefined,
) {
  await requireAdminSession(supabaseUrl, serviceRoleKey, sessionToken);
  const result = await callRpc(supabaseUrl, serviceRoleKey, "seating_chart_set_edit_pin", {
    session_token: sessionToken,
    target_slug: slug,
    new_pin: pin || null,
  });
  if (!result.ok) {
    throw new HttpError(result.status, rpcErrorMessage(result));
  }
  return jsonResponse({ success: true, ...(result.body as Record<string, unknown>) });
}

async function setViewPin(
  supabaseUrl: string,
  serviceRoleKey: string,
  slug: string,
  sessionToken: string | null,
  enabled: boolean,
  pin: string | undefined,
) {
  await requireAdminSession(supabaseUrl, serviceRoleKey, sessionToken);
  const result = await callRpc(supabaseUrl, serviceRoleKey, "seating_chart_set_view_pin", {
    session_token: sessionToken,
    target_slug: slug,
    enabled,
    new_pin: pin || null,
  });
  if (!result.ok) {
    throw new HttpError(result.status, rpcErrorMessage(result));
  }
  return jsonResponse({ success: true, ...(result.body as Record<string, unknown>) });
}

interface GuestRow {
  id: number;
  full_name: string;
  group_id: string;
  is_primary: boolean;
  is_plus_one: boolean;
  is_child: boolean;
  meal_choice: string | null;
  dietary_notes: string | null;
}

// The connector: accepted guests, grouped by party/group_id, shaped for
// import into a seating chart's guest list — the same grouping public.guests
// already uses (search_guest_groups, list_admin_guests), so a synced guest
// carries its party rather than arriving as a flat, ungrouped name list.
// Admin-only — link recipients editing via PIN never trigger a pull of the
// real RSVP list.
async function fetchAcceptedGuestParties(supabaseUrl: string, serviceRoleKey: string) {
  const params = new URLSearchParams({
    rsvp_status: "eq.accepted",
    select: "id,full_name,group_id,is_primary,is_plus_one,is_child,meal_choice,dietary_notes",
    order: "group_id.asc,is_primary.desc,full_name.asc",
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/guests?${params.toString()}`, {
    headers: serviceHeaders(serviceRoleKey),
  });
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
      isPlusOne: boolean;
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
      isPlusOne: Boolean(row.is_plus_one),
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
    ? segments.slice(-1).join("/")
    : segments.slice(functionNameIndex + 1).join("/");

  const { supabaseUrl, serviceRoleKey } = getEnvConfig();
  const sessionToken = req.headers.get("x-km-session-token");
  const slug = url.searchParams.get("slug") || "";
  const ip = clientIp(req);

  if (route === "venues" && req.method === "GET") {
    return listVenues(supabaseUrl, serviceRoleKey, sessionToken);
  }

  if (route === "venues" && req.method === "POST") {
    const body = await req.json().catch(() => ({})) as { eventTitle?: string };
    return createVenue(supabaseUrl, serviceRoleKey, sessionToken, body.eventTitle);
  }

  if (route === "venue" && req.method === "GET") {
    if (!slug) throw new HttpError(400, "slug is required.");
    const viewPin = url.searchParams.get("viewPin");
    const editPin = url.searchParams.get("editPin");
    return getVenue(supabaseUrl, serviceRoleKey, slug, sessionToken, viewPin, editPin, ip);
  }

  if (route === "venue" && req.method === "PUT") {
    if (!slug) throw new HttpError(400, "slug is required.");
    const body = await req.json().catch(() => null) as
      | { venueData?: unknown; editPin?: string }
      | null;
    if (!body || typeof body.venueData === "undefined") {
      throw new HttpError(400, "venueData is required.");
    }
    return saveVenue(supabaseUrl, serviceRoleKey, slug, sessionToken, body.venueData, body.editPin, ip);
  }

  if (route === "venue/validate-pin" && req.method === "POST") {
    if (!slug) throw new HttpError(400, "slug is required.");
    const body = await req.json().catch(() => ({})) as { pin?: string; kind?: string };
    if (!body.pin) throw new HttpError(400, "pin is required.");
    if (body.kind !== "view" && body.kind !== "edit") {
      throw new HttpError(400, "kind must be 'view' or 'edit'.");
    }
    return validatePin(supabaseUrl, serviceRoleKey, slug, body.kind, body.pin, ip);
  }

  if (route === "venue/set-edit-pin" && req.method === "POST") {
    if (!slug) throw new HttpError(400, "slug is required.");
    const body = await req.json().catch(() => ({})) as { pin?: string };
    return setEditPin(supabaseUrl, serviceRoleKey, slug, sessionToken, body.pin);
  }

  if (route === "venue/set-view-pin" && req.method === "POST") {
    if (!slug) throw new HttpError(400, "slug is required.");
    const body = await req.json().catch(() => ({})) as { enabled?: boolean; pin?: string };
    if (typeof body.enabled !== "boolean") {
      throw new HttpError(400, "enabled (boolean) is required.");
    }
    return setViewPin(supabaseUrl, serviceRoleKey, slug, sessionToken, body.enabled, body.pin);
  }

  if (route === "guests" && req.method === "GET") {
    await requireAdminSession(supabaseUrl, serviceRoleKey, sessionToken);
    const parties = await fetchAcceptedGuestParties(supabaseUrl, serviceRoleKey);
    return jsonResponse({ success: true, parties, generatedAt: new Date().toISOString() });
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
        return jsonResponse({ success: false, error: err.message }, err.status);
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[seating-chart-api]", message);
      return jsonResponse({ success: false, error: message }, 500);
    }
  });
}
