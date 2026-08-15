// Shaped after the wedding site's own guest record (public.guests /
// data-client.js), not upstream Seating-Planner's flat
// firstName/lastName pair — so a guest pulled in via the accepted-guests
// connector (see lib/api/guestConnector.ts) carries the same fields the
// RSVP/admin side already knows about it, including its party.
export interface Guest {
  id: string;
  fullName: string;
  tableId: string;
  chairIndex: number;
  // Set when this guest was imported via the connector. Used to dedupe
  // re-imports without disturbing seating assignments already made for
  // that guest. Guests added by hand in this app have neither.
  weddingGuestId?: string;
  groupId?: string;
  isPrimary?: boolean;
  isPlusOne?: boolean;
  isChild?: boolean;
  mealChoice?: string | null;
  dietaryNotes?: string | null;
}

export interface Table {
  type: "table";
  id: string;
  number: number;
  x: number;
  y: number;
  // Missing/omitted means "round" — every table saved before this field
  // existed is a round table, so this keeps old venue data working as-is.
  shape?: "round" | "rectangle";
  radius: number; // round tables only
  width?: number; // rectangle tables only
  height?: number; // rectangle tables only
  // Rectangle tables only. Missing/"all" seats guests around all four
  // edges, proportional to edge length (the default, existing look).
  // "opposing" seats guests only on the top and bottom edges — the
  // classic banquet-table look — with topSeats/bottomSeats set
  // independently rather than always split evenly.
  seatingStyle?: "all" | "opposing";
  topSeats?: number; // rectangle tables in "opposing" seatingStyle only
  bottomSeats?: number; // rectangle tables in "opposing" seatingStyle only
  capacity: number;
  draggable?: boolean;
  // Degrees, clockwise. Missing/omitted means 0 — every table saved
  // before rotation existed renders unrotated, as before.
  rotation?: number;
  // When true, this specific table's position is fixed: it can't be
  // dragged. That's all it does — resizing, rotating, capacity/seating
  // layout changes, duplication, and deletion are unaffected, and so is
  // seat assignment (see seatingLocked below for that). Independent of
  // the venue-space lock, which only governs the venue space shape
  // itself. Missing/omitted means unlocked, same as every table saved
  // before this existed.
  locked?: boolean;
  // When true, this table's seat assignments are frozen: guests can't be
  // added, removed, or rearranged into/out of/within its seats, from
  // either the sidebar guest list or by dragging a guest's seat node on
  // the canvas. Toggled from the table's row in the sidebar guest list,
  // not from the canvas. Independent of `locked` above — a table can be
  // draggable with its seating locked, or fixed in place with its seating
  // wide open. Missing/omitted means unlocked, same as every table saved
  // before this existed.
  seatingLocked?: boolean;
}

export interface VenueElement {
  type: "venue";
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  stroke?: string;
  strokeWidth?: number;
  draggable?: boolean;
}

// An uploaded reference image (a photo/scan/export of the venue's real
// floorplan) placed behind everything else on the canvas so tables can be
// arranged against it. At most one exists at a time — uploading a new one
// replaces it. See lib/backgroundImageProcessing.ts for how `dataUrl`
// ends up self-contained and size-capped before it ever reaches here.
export interface BackgroundImage {
  type: "backgroundImage";
  id: string;
  // A self-contained data: URI (image/webp, image/png, image/jpeg,
  // image/gif, image/bmp, or image/svg+xml) — never a remote URL, so
  // rendering it never depends on a separate fetch or storage bucket.
  dataUrl: string;
  // Pixel dimensions of the image data `dataUrl` actually decodes to
  // (post any downscaling) — the shape's on-canvas size before `scale`.
  naturalWidth: number;
  naturalHeight: number;
  x: number; // top-left corner, like VenueElement
  y: number;
  // Uniform scale factor applied to naturalWidth/naturalHeight — resizing
  // this shape always preserves its aspect ratio, unlike VenueElement.
  scale: number;
  // Degrees, clockwise, free rotation (no 45° snapping — unlike tables,
  // a photographed or scanned floorplan is rarely already axis-aligned).
  rotation?: number;
  opacity: number; // 0-1
  // Same meaning as Table.locked: blocks drag/resize/rotate/delete for
  // this shape specifically. Missing/omitted means unlocked.
  locked?: boolean;
}
