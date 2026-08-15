// Pure table/chair geometry, shared between what actually gets rendered
// (TableCircle.tsx) and the group-drag seat planner (groupSeating.ts) —
// both need the exact same "which chairIndex is on which side" answer, so
// there's exactly one place that computes it.

export type TableSide = "top" | "right" | "bottom" | "left";

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
): ChairPosition[] => {
  const halfW = width / 2;
  const halfH = height / 2;
  const offset = chairRadius + padding;
  const cornerMargin = chairRadius * 1.5;
  const usableHorizontal = Math.max(width - cornerMargin * 2, chairRadius);
  const usableVertical = Math.max(height - cornerMargin * 2, chairRadius);

  const sides: { key: TableSide; length: number }[] = [
    { key: "top", length: usableHorizontal },
    { key: "right", length: usableVertical },
    { key: "bottom", length: usableHorizontal },
    { key: "left", length: usableVertical },
  ];
  const totalLength = sides.reduce((sum, s) => sum + s.length, 0) || 1;

  // Largest-remainder allocation: proportional seat counts per side that
  // always sum to exactly `capacity`.
  const raw = sides.map((s) => (s.length / totalLength) * capacity);
  const counts = raw.map((n) => Math.floor(n));
  let remaining = capacity - counts.reduce((a, b) => a + b, 0);
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
