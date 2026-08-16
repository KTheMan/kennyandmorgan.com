import type { Guest, Table, TableEdge } from "../types/seatingChart";
import { computeTableChairPositions } from "./tableSeating";

export const TABLE_EDGES: TableEdge[] = ["top", "right", "bottom", "left"];
export const oppositeTableEdge = (edge: TableEdge): TableEdge =>
  ({ top: "bottom", right: "left", bottom: "top", left: "right" })[edge] as TableEdge;

export const getLinkedTableComponent = (tables: Table[], startId: string): Table[] => {
  const byId = new Map(tables.map((table) => [table.id, table]));
  const seen = new Set<string>();
  const pending = [startId];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const table = byId.get(id);
    if (!table) continue;
    Object.values(table.linkedEdges ?? {}).forEach((link) => {
      if (link && !seen.has(link.tableId)) pending.push(link.tableId);
    });
  }
  return [...seen].map((id) => byId.get(id)).filter((table): table is Table => Boolean(table));
};

export const getMergedSeatingMembers = (tables: Table[], tableId: string): Table[] => {
  const component = getLinkedTableComponent(tables, tableId);
  return component.length > 1 && component.some((table) => table.linkedSeatingMerged)
    ? component.sort((a, b) => a.number - b.number || a.id.localeCompare(b.id))
    : component.filter((table) => table.id === tableId);
};

export const getMergedSeatingPrimary = (tables: Table[], tableId: string): Table | null =>
  getMergedSeatingMembers(tables, tableId)[0] ?? null;

interface WorldEdge {
  table: Table;
  edge: TableEdge;
  center: { x: number; y: number };
  normal: { x: number; y: number };
  tangent: { x: number; y: number };
  halfLength: number;
}

const rotate = (x: number, y: number, degrees: number) => {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
};

const getWorldEdge = (table: Table, edge: TableEdge): WorldEdge => {
  const width = table.width ?? table.radius * 2;
  const height = table.height ?? table.radius * 2;
  const locals = {
    top: { center: { x: 0, y: -height / 2 }, normal: { x: 0, y: -1 }, tangent: { x: 1, y: 0 }, halfLength: width / 2 },
    right: { center: { x: width / 2, y: 0 }, normal: { x: 1, y: 0 }, tangent: { x: 0, y: 1 }, halfLength: height / 2 },
    bottom: { center: { x: 0, y: height / 2 }, normal: { x: 0, y: 1 }, tangent: { x: 1, y: 0 }, halfLength: width / 2 },
    left: { center: { x: -width / 2, y: 0 }, normal: { x: -1, y: 0 }, tangent: { x: 0, y: 1 }, halfLength: height / 2 },
  }[edge];
  const rotation = table.rotation ?? 0;
  const centerOffset = rotate(locals.center.x, locals.center.y, rotation);
  return {
    table,
    edge,
    center: { x: table.x + centerOffset.x, y: table.y + centerOffset.y },
    normal: rotate(locals.normal.x, locals.normal.y, rotation),
    tangent: rotate(locals.tangent.x, locals.tangent.y, rotation),
    halfLength: locals.halfLength,
  };
};

export interface TableLinkCandidate {
  tableId: string;
  edge: TableEdge;
  otherTableId: string;
  otherEdge: TableEdge;
}

export const findButtedTableEdge = (
  table: Table,
  tables: Table[],
  tolerance = 18,
): TableLinkCandidate | null => {
  if (table.shape !== "rectangle") return null;
  let best: { candidate: TableLinkCandidate; score: number } | null = null;

  for (const edge of TABLE_EDGES) {
    if (table.linkedEdges?.[edge]) continue;
    const a = getWorldEdge(table, edge);
    for (const other of tables) {
      if (other.id === table.id || other.shape !== "rectangle") continue;
      for (const otherEdge of TABLE_EDGES) {
        if (other.linkedEdges?.[otherEdge]) continue;
        const b = getWorldEdge(other, otherEdge);
        const normalDot = a.normal.x * b.normal.x + a.normal.y * b.normal.y;
        if (normalDot > -0.985) continue;
        const dx = b.center.x - a.center.x;
        const dy = b.center.y - a.center.y;
        const perpendicularGap = Math.abs(dx * a.normal.x + dy * a.normal.y);
        if (perpendicularGap > tolerance) continue;
        const tangentOffset = Math.abs(dx * a.tangent.x + dy * a.tangent.y);
        const overlap = a.halfLength + b.halfLength - tangentOffset;
        if (overlap < 24) continue;
        const score = perpendicularGap + tangentOffset * 0.05;
        if (!best || score < best.score) {
          best = {
            score,
            candidate: { tableId: table.id, edge, otherTableId: other.id, otherEdge },
          };
        }
      }
    }
  }

  return best?.candidate ?? null;
};

export const getChairIndexesOnEdge = (table: Table, edge: TableEdge): number[] =>
  computeTableChairPositions(table)
    .map((position, index) => ({ position, index }))
    .filter(({ position }) => position.side === edge)
    .map(({ index }) => index);

export const getOccupiedGuestsOnEdge = (
  table: Table,
  edge: TableEdge,
  guests: Guest[],
): Guest[] => {
  const indexes = new Set(getChairIndexesOnEdge(table, edge));
  return guests.filter(
    (guest) => guest.tableId === table.id && indexes.has(guest.chairIndex),
  );
};

export const compactGuestsAfterSeatRemovals = (
  guests: Guest[],
  tableId: string,
  removedIndexes: number[],
): Guest[] => {
  const sorted = [...removedIndexes].sort((a, b) => a - b);
  return guests.map((guest) => {
    if (guest.tableId !== tableId) return guest;
    const shift = sorted.filter((index) => index < guest.chairIndex).length;
    return shift > 0 ? { ...guest, chairIndex: guest.chairIndex - shift } : guest;
  });
};

export const restoreGuestsAfterSeatInsertions = (
  guests: Guest[],
  tableId: string,
  insertedIndexes: number[],
): Guest[] => {
  const sorted = [...insertedIndexes].sort((a, b) => a - b);
  return guests.map((guest) => {
    if (guest.tableId !== tableId) return guest;
    let restoredIndex = guest.chairIndex;
    sorted.forEach((index) => {
      if (index <= restoredIndex) restoredIndex += 1;
    });
    return restoredIndex !== guest.chairIndex
      ? { ...guest, chairIndex: restoredIndex }
      : guest;
  });
};

export const restoredCapacityAfterUnlink = (table: Table, edge: TableEdge): Partial<Table> => {
  const removed = table.linkedEdges?.[edge]?.removedSeats ?? 0;
  const updates: Partial<Table> = { capacity: table.capacity + removed };
  if (table.seatingStyle === "opposing") {
    if (edge === "top") updates.topSeats = (table.topSeats ?? 0) + removed;
    if (edge === "bottom") updates.bottomSeats = (table.bottomSeats ?? 0) + removed;
  }
  return updates;
};
