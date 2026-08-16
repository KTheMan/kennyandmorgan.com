import type { Table, VenueElement } from "../types/seatingChart";
import { GRID_SIZE, snapToGrid } from "./gridSnap";
import { getTableBounds, type Bounds } from "./tableAlignment";

const DUPLICATE_CLEARANCE = 48;
const VENUE_EDGE_PADDING = DUPLICATE_CLEARANCE / 2;
const VENUELESS_SEARCH_RINGS = 12;

const expandBounds = (bounds: Bounds, amount: number): Bounds => ({
  left: bounds.left - amount,
  right: bounds.right + amount,
  top: bounds.top - amount,
  bottom: bounds.bottom + amount,
});

const boundsOverlap = (left: Bounds, right: Bounds) =>
  left.left < right.right &&
  left.right > right.left &&
  left.top < right.bottom &&
  left.bottom > right.top;

const ceilToGrid = (value: number) => Math.ceil(value / GRID_SIZE) * GRID_SIZE;
const floorToGrid = (value: number) => Math.floor(value / GRID_SIZE) * GRID_SIZE;

const ringCandidates = (centerX: number, centerY: number, ring: number) => {
  if (ring === 0) return [{ x: centerX, y: centerY }];
  const candidates: Array<{ x: number; y: number }> = [];
  for (let offset = -ring; offset <= ring; offset += 1) {
    candidates.push(
      { x: centerX + ring * GRID_SIZE, y: centerY + offset * GRID_SIZE },
      { x: centerX + offset * GRID_SIZE, y: centerY + ring * GRID_SIZE },
      { x: centerX - ring * GRID_SIZE, y: centerY + offset * GRID_SIZE },
      { x: centerX + offset * GRID_SIZE, y: centerY - ring * GRID_SIZE },
    );
  }
  return candidates;
};

/**
 * Finds the nearest grid-aligned position where a duplicate table will not
 * overlap an existing table. The Venue Space search visits every viable grid
 * point in expanding rings, so off-axis openings cannot be skipped.
 */
export const findDuplicateTablePosition = (
  source: Table,
  tables: Table[],
  venue?: VenueElement,
) => {
  const sourceBounds = expandBounds(getTableBounds(source), VENUE_EDGE_PADDING);
  const occupiedBounds = tables.map((table) =>
    expandBounds(getTableBounds(table), DUPLICATE_CLEARANCE / 2),
  );
  const centerX = snapToGrid(source.x);
  const centerY = snapToGrid(source.y);
  const leftExtent = source.x - sourceBounds.left;
  const rightExtent = sourceBounds.right - source.x;
  const topExtent = source.y - sourceBounds.top;
  const bottomExtent = sourceBounds.bottom - source.y;

  const getCandidateBounds = (candidate: { x: number; y: number }) => ({
    left: candidate.x - leftExtent,
    right: candidate.x + rightExtent,
    top: candidate.y - topExtent,
    bottom: candidate.y + bottomExtent,
  });
  const isOpen = (candidate: { x: number; y: number }) => {
    const bounds = getCandidateBounds(candidate);
    return occupiedBounds.every((occupied) => !boundsOverlap(bounds, occupied));
  };

  let minX = centerX - VENUELESS_SEARCH_RINGS * GRID_SIZE;
  let maxX = centerX + VENUELESS_SEARCH_RINGS * GRID_SIZE;
  let minY = centerY - VENUELESS_SEARCH_RINGS * GRID_SIZE;
  let maxY = centerY + VENUELESS_SEARCH_RINGS * GRID_SIZE;
  if (venue) {
    minX = ceilToGrid(venue.x + leftExtent);
    maxX = floorToGrid(venue.x + venue.width - rightExtent);
    minY = ceilToGrid(venue.y + topExtent);
    maxY = floorToGrid(venue.y + venue.height - bottomExtent);
  }

  if (minX <= maxX && minY <= maxY) {
    const maxRing = Math.max(
      Math.ceil(Math.abs(minX - centerX) / GRID_SIZE),
      Math.ceil(Math.abs(maxX - centerX) / GRID_SIZE),
      Math.ceil(Math.abs(minY - centerY) / GRID_SIZE),
      Math.ceil(Math.abs(maxY - centerY) / GRID_SIZE),
    );
    for (let ring = 1; ring <= maxRing; ring += 1) {
      for (const candidate of ringCandidates(centerX, centerY, ring)) {
        if (
          candidate.x >= minX &&
          candidate.x <= maxX &&
          candidate.y >= minY &&
          candidate.y <= maxY &&
          isOpen(candidate)
        ) {
          return candidate;
        }
      }
    }
  }

  // If the venue is completely packed (or a venue-less nearby search is
  // exhausted), place the copy immediately beyond every occupied right edge.
  // Its left edge is at or beyond maxRight, which guarantees no overlap.
  const maxRight = Math.max(
    venue ? venue.x + venue.width : Number.NEGATIVE_INFINITY,
    ...occupiedBounds.map((bounds) => bounds.right),
  );
  return {
    x: ceilToGrid(maxRight + leftExtent),
    y: centerY,
  };
};
