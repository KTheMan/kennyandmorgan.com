// Pure table/chair geometry, shared between what actually gets rendered
// (TableCircle.tsx) and the group-drag seat planner (groupSeating.ts) —
// both need the exact same "which chairIndex is on which side" answer, so
// there's exactly one place that computes it.

import type { Table, TableEdge } from "../types/seatingChart";

export type TableSide = TableEdge;

export interface ChairPosition {
  x: number;
  y: number;
  angle: number;
  side: TableSide;
}

// Matches the values TableCircle.tsx has always drawn chairs at.
export const CHAIR_RADIUS = 8;
export const CHAIR_PADDING = 5;

// Seats for a rectangular table are spread along its four edges,
// proportional to each edge's length (so a long banquet table gets most
// of its seats on the long sides), evenly spaced within each edge and
// kept clear of the corners, then pushed outward by chairRadius+padding
// — mirroring how round tables place seats at radius+chairRadius+padding
// from center.
export const computeRectangleChairPositions = (
  width: number,
  height: number,
  capacity: number,
  chairRadius: number,
  padding: number,
  excludedSides: ReadonlySet<TableSide> = new Set(),
): ChairPosition[] => {
  const halfW = width / 2;
  const halfH = height / 2;
  const offset = chairRadius + padding;
  const cornerMargin = chairRadius * 1.5;
  const usableHorizontal = Math.max(width - cornerMargin * 2, chairRadius);
  const usableVertical = Math.max(height - cornerMargin * 2, chairRadius);

  const allSides: { key: TableSide; length: number }[] = [
    { key: "top", length: usableHorizontal },
    { key: "right", length: usableVertical },
    { key: "bottom", length: usableHorizontal },
    { key: "left", length: usableVertical },
  ];
  const sides = allSides.filter((side) => !excludedSides.has(side.key));
  const totalLength = sides.reduce((sum, s) => sum + s.length, 0) || 1;

  // Largest-remainder allocation: proportional seat counts per side that
  // always sum to exactly `capacity`.
  const raw = sides.map((s) => (s.length / totalLength) * capacity);
  const counts = raw.map((n) => Math.floor(n));
  const remaining = capacity - counts.reduce((a, b) => a + b, 0);
  const byRemainder = raw
    .map((n, i) => ({ i, frac: n - counts[i] }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remaining && byRemainder.length > 0; k++) {
    counts[byRemainder[k % byRemainder.length].i] += 1;
  }

  const positions: ChairPosition[] = [];
  sides.forEach((side, sideIndex) => {
    const count = counts[sideIndex];
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? (i + 0.5) / count - 0.5 : 0; // -0.5..0.5 along the edge
      const along = t * side.length;
      switch (side.key) {
        case "top":
          positions.push({ x: along, y: -halfH - offset, angle: -Math.PI / 2, side: "top" });
          break;
        case "right":
          positions.push({ x: halfW + offset, y: along, angle: 0, side: "right" });
          break;
        case "bottom":
          positions.push({ x: along, y: halfH + offset, angle: Math.PI / 2, side: "bottom" });
          break;
        case "left":
          positions.push({ x: -halfW - offset, y: along, angle: Math.PI, side: "left" });
          break;
      }
    }
  });
  return positions;
};

// Seats for a rectangular table in "opposing" seatingStyle sit only on the
// top and bottom edges — the classic banquet-table look — with each
// side's count set independently (asymmetric is fine: 5 on top, 3 on the
// bottom is a valid layout, not just an even split).
export const computeOpposingSidesChairPositions = (
  width: number,
  height: number,
  topSeats: number,
  bottomSeats: number,
  chairRadius: number,
  padding: number,
): ChairPosition[] => {
  const halfW = width / 2;
  const halfH = height / 2;
  const offset = chairRadius + padding;
  const cornerMargin = chairRadius * 1.5;
  const usableWidth = Math.max(width - cornerMargin * 2, chairRadius);

  const placeAlongEdge = (
    count: number,
    y: number,
    angle: number,
    side: TableSide,
  ): ChairPosition[] => {
    const positions: ChairPosition[] = [];
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? (i + 0.5) / count - 0.5 : 0; // -0.5..0.5 along the edge
      positions.push({ x: t * usableWidth, y, angle, side });
    }
    return positions;
  };

  return [
    ...placeAlongEdge(topSeats, -halfH - offset, -Math.PI / 2, "top"),
    ...placeAlongEdge(bottomSeats, halfH + offset, Math.PI / 2, "bottom"),
  ];
};

// Seat position for chair `index` of `capacity` around a round table —
// the same angle formula TableCircle.tsx has always used (chair 0 at the
// top, going clockwise).
export const roundTableChairAngle = (index: number, capacity: number): number =>
  (index * (2 * Math.PI)) / capacity - Math.PI / 2;

export const computeTableChairPositions = (table: Table): ChairPosition[] => {
  const excludedSides = new Set(
    Object.keys(table.linkedEdges ?? {}) as TableSide[],
  );

  if (table.shape === "rectangle") {
    const width = table.width ?? table.radius * 2;
    const height = table.height ?? table.radius * 2;
    return table.seatingStyle === "opposing"
      ? computeOpposingSidesChairPositions(
          width,
          height,
          excludedSides.has("top") ? 0 : table.topSeats ?? Math.ceil(table.capacity / 2),
          excludedSides.has("bottom") ? 0 : table.bottomSeats ?? Math.floor(table.capacity / 2),
          CHAIR_RADIUS,
          CHAIR_PADDING,
        )
      : computeRectangleChairPositions(
          width,
          height,
          table.capacity,
          CHAIR_RADIUS,
          CHAIR_PADDING,
          excludedSides,
        );
  }

  const distance = table.radius + CHAIR_RADIUS + CHAIR_PADDING;
  return Array.from({ length: table.capacity }, (_, index) => {
    const angle = roundTableChairAngle(index, table.capacity);
    return {
      x: distance * Math.cos(angle),
      y: distance * Math.sin(angle),
      angle,
      side: "top" as const,
    };
  });
};
