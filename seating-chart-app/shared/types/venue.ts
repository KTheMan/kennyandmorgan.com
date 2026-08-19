import type { Table, VenueElement, Guest, BackgroundImage } from "../../src/types/seatingChart";

/**
 * Represents the data structure stored in the venue_data JSONB column
 * and potentially in localStorage.
 */
export interface VenueData {
  shapes: Array<VenueElement | Table | BackgroundImage>; // Represents the shapes array
  guests: Guest[];
  eventTitle: string;
  tableCounter: number;
  versions?: VenueVersion[];
  versionBackgroundAssets?: Record<string, string>;
  // Add other relevant state properties managed by atoms if needed
  // e.g., venueSpaceLocked?: boolean;
}

/** A chart configuration without the surrounding saved-version collection. */
export type VenueSnapshotData = Omit<VenueData, "versions" | "versionBackgroundAssets">;

export type VenueVersionBackgroundImage = Omit<BackgroundImage, "dataUrl"> & {
  // New snapshots reference the venue-level deduplicated asset pool. dataUrl
  // remains optional only for backwards compatibility with early snapshots.
  versionAssetId?: string;
  dataUrl?: string;
};

export interface VenueVersionSnapshotData {
  shapes: Array<VenueElement | Table | VenueVersionBackgroundImage>;
  guests: Guest[];
  eventTitle: string;
  tableCounter: number;
}

/** A user-named, persistent milestone stored alongside the live chart. */
export interface VenueVersion {
  id: string;
  name: string;
  createdAt: string;
  data: VenueVersionSnapshotData;
}

/**
 * Represents the full venue object as stored in the database
 * and returned by API endpoints.
 */
export interface Venue {
  slug: string;
  venue_data: VenueData; // Embed the VenueData structure
  created_at: string; // ISO 8601 date string (TIMESTAMPTZ)
  updated_at: string; // ISO 8601 date string (TIMESTAMPTZ)
}

// Optional: Type for the API response when creating a venue
export interface CreateVenueResponse {
  slug: string;
}
