// Pure planning logic for "drag a whole party onto a table": given where
// over the table you're hovering, decide which chairs the group would
// land in. Used twice — once per pointer move to drive the live preview,
// and once more at drop time to actually commit — so it has to be a pure
// function of (table, occupied seats, group size, pointer position) with
// no hidden state, or the preview and the actual result could disagree.
//
// This is a one-time placement helper only: once a group is dropped, each
// guest gets an ordinary tableId/chairIndex like any guest placed one at a
// time. Nothing here creates a lasting link between the guests in a group.

import { Table } from "../types/seatingChart";
import {
  CHAIR_RADIUS,
  CHAIR_PADDING,
  computeRectangleChairPositions,
  computeOpposingSidesChairPositions,
  roundTableChairAngle,
  type TableSide,
} from "./tableSeating";

export interface StagePoint {
  x: number;
  y: number;
}

const clampNum = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));

// Is the pointer close enough to `table` to target it, and where does it
// land in the table's own unrotated local coordinates (origin at the
// table's center, same frame the chair-position functions use)? `margin`
// extends the hit area beyond the table's own body so hovering over the
// ring of chairs (which sit outside the table edge) still counts.
export function findTableUnderPoint(
  tables: Table[],
  point: StagePoint,
  margin: number,
): { table: Table; localX: number; localY: number } | null {
  for (const table of tables) {
    const dx = point.x - table.x;
    const dy = point.y - table.y;
    const rotationRad = (-(table.rotation ?? 0) * Math.PI) / 180;
    const cos = Math.cos(rotationRad);
    const sin = Math.sin(rotationRad);
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;

    if (table.shape === "rectangle") {
      const halfW = (table.width ?? table.radius * 2) / 2;
      const halfH = (table.height ?? table.radius * 2) / 2;
      if (Math.abs(localX) <= halfW + margin && Math.abs(localY) <= halfH + margin) {
        return { table, localX, localY };
      }
    } else if (Math.hypot(localX, localY) <= table.radius + margin) {
      return { table, localX, localY };
    }
  }
  return null;
}

const partitionSeatIndexesBySide = (table: Table): Record<TableSide, number[]> => {
  const width = table.width ?? table.radius * 2;
  const height = table.height ?? table.radius * 2;
  const positions =
    table.seatingStyle === "opposing"
      ? computeOpposingSidesChairPositions(
          width,
          height,
          table.topSeats ?? Math.ceil(table.capacity / 2),
          table.bottomSeats ?? Math.floor(table.capacity / 2),
          CHAIR_RADIUS,
          CHAIR_PADDING,
        )
      : computeRectangleChairPositions(width, height, table.capacity, CHAIR_RADIUS, CHAIR_PADDING);

  const bySide: Record<TableSide, number[]> = { top: [], right: [], bottom: [], left: [] };
  positions.forEach((pos, index) => bySide[pos.side].push(index));
  return bySide;
};

// Drains each side in `sideOrder` fully before moving to the next — "fill
// this side, only spill onto the next if it runs out."
const fillSequential = (
  sideOrder: TableSide[],
  bySide: Record<TableSide, number[]>,
  occupied: Set<number>,
  groupSize: number,
): number[] => {
  const result: number[] = [];
  for (const side of sideOrder) {
    for (const index of bySide[side]) {
      if (result.length >= groupSize) return result;
      if (!occupied.has(index)) result.push(index);
    }
  }
  return result;
};

// Takes one seat from each side in `sideOrder` in turn, looping back
// around — spreads the group evenly across every side instead of
// emptying one before touching the next.
const fillRoundRobin = (
  sideOrder: TableSide[],
  bySide: Record<TableSide, number[]>,
  occupied: Set<number>,
  groupSize: number,
): number[] => {
  const queues = sideOrder.map((side) => bySide[side].filter((index) => !occupied.has(index)));
  const result: number[] = [];
  let tookAny = true;
  while (result.length < groupSize && tookAny) {
    tookAny = false;
    for (const queue of queues) {
      if (result.length >= groupSize) break;
      const next = queue.shift();
      if (next !== undefined) {
        result.push(next);
        tookAny = true;
      }
    }
  }
  return result;
};

// Within this fraction of the table's half-height from the vertical
// center, a drag is treated as "on the centerline" and spreads the group
// instead of preferring one side.
const CENTER_THRESHOLD_RATIO = 0.35;

const planRoundTable = (
  table: Table,
  occupied: Set<number>,
  groupSize: number,
  localX: number,
  localY: number,
): number[] => {
  // Cluster around wherever the pointer actually is: sort every empty
  // seat by angular distance from the pointer and take the closest N,
  // which naturally spreads outward on both sides of the nearest seat
  // rather than always starting at chair 0.
  const pointerAngle = Math.atan2(localY, localX);
  const candidates: { index: number; angularDistance: number }[] = [];
  for (let i = 0; i < table.capacity; i++) {
    if (occupied.has(i)) continue;
    const chairAngle = roundTableChairAngle(i, table.capacity);
    let diff = Math.abs(chairAngle - pointerAngle) % (2 * Math.PI);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    candidates.push({ index: i, angularDistance: diff });
  }
  candidates.sort((a, b) => a.angularDistance - b.angularDistance);
  return candidates.slice(0, groupSize).map((c) => c.index);
};

const planRectangleTable = (
  table: Table,
  occupied: Set<number>,
  groupSize: number,
  localY: number,
): number[] => {
  const height = table.height ?? table.radius * 2;
  const halfHeight = height / 2 || 1;
  const verticalRatio = clampNum(localY / halfHeight, -1, 1);
  const nearCenter = Math.abs(verticalRatio) < CENTER_THRESHOLD_RATIO;
  const bySide = partitionSeatIndexesBySide(table);
  // Whichever side the pointer is closer to goes first when preferring a
  // side; when spreading, this just sets which side gets the earlier
  // (lower-index) guests, which is an arbitrary but stable tiebreak.
  const topBottomOrder: TableSide[] = verticalRatio <= 0 ? ["top", "bottom"] : ["bottom", "top"];
  const hasEndSeats = table.seatingStyle !== "opposing";
  const sideOrder: TableSide[] = hasEndSeats
    ? [...topBottomOrder, "left", "right"]
    : topBottomOrder;

  return nearCenter
    ? fillRoundRobin(sideOrder, bySide, occupied, groupSize)
    : fillSequential(sideOrder, bySide, occupied, groupSize);
};

// The one entry point: where would `groupSize` guests land if dropped at
// (localX, localY) inside `table`'s own local coordinate frame? Returns
// null if the table doesn't have enough empty seats left. The returned
// chairIndexes are in guest order — result[0] is where the first guest in
// the dragged group goes, and so on.
export function computeGroupSeatPlan(
  table: Table,
  occupied: Set<number>,
  groupSize: number,
  localX: number,
  localY: number,
): number[] | null {
  if (groupSize <= 0) return null;
  const emptySeats = table.capacity - occupied.size;
  if (emptySeats < groupSize) return null;

  const plan =
    table.shape === "rectangle"
      ? planRectangleTable(table, occupied, groupSize, localY)
      : planRoundTable(table, occupied, groupSize, localX, localY);

  return plan.length === groupSize ? plan : null;
}
