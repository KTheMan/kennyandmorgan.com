export interface Guest {
  id: string;
  firstName: string;
  lastName: string;
  tableId: string;
  chairIndex: number;
  // Set when this guest was imported via the accepted-guests connector
  // (see lib/api/guestConnector.ts). Used to dedupe re-imports without
  // disturbing seating assignments already made for that guest.
  weddingGuestId?: string;
  groupId?: string;
  mealChoice?: string | null;
  dietaryNotes?: string | null;
}

export interface Table {
  type: "table";
  id: string;
  number: number;
  x: number;
  y: number;
  radius: number;
  capacity: number;
  draggable?: boolean;
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
