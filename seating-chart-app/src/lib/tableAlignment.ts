import type { Table } from "../types/seatingChart";
import { getLinkedTableComponent } from "./tableLinks";

export type TableAlignment =
  | "left"
  | "centerX"
  | "right"
  | "top"
  | "centerY"
  | "bottom";

export interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface TableSelectionUnit {
  id: string;
  tables: Table[];
  bounds: Bounds;
}

export const getTableBounds = (table: Table): Bounds => {
  if (table.shape !== "rectangle") {
    return {
      left: table.x - table.radius,
      right: table.x + table.radius,
      top: table.y - table.radius,
      bottom: table.y + table.radius,
    };
  }

  const halfWidth = (table.width ?? table.radius * 2) / 2;
  const halfHeight = (table.height ?? table.radius * 2) / 2;
  const radians = ((table.rotation ?? 0) * Math.PI) / 180;
  const extentX = Math.abs(Math.cos(radians)) * halfWidth + Math.abs(Math.sin(radians)) * halfHeight;
  const extentY = Math.abs(Math.sin(radians)) * halfWidth + Math.abs(Math.cos(radians)) * halfHeight;
  return {
    left: table.x - extentX,
    right: table.x + extentX,
    top: table.y - extentY,
    bottom: table.y + extentY,
  };
};

const combineBounds = (bounds: Bounds[]): Bounds => ({
  left: Math.min(...bounds.map((item) => item.left)),
  right: Math.max(...bounds.map((item) => item.right)),
  top: Math.min(...bounds.map((item) => item.top)),
  bottom: Math.max(...bounds.map((item) => item.bottom)),
});

export const getSelectedTableUnits = (
  tables: Table[],
  selectedIds: ReadonlySet<string>,
): TableSelectionUnit[] => {
  const visited = new Set<string>();
  const units: TableSelectionUnit[] = [];
  for (const table of tables) {
    if (!selectedIds.has(table.id) || visited.has(table.id)) continue;
    const component = getLinkedTableComponent(tables, table.id);
    component.forEach((member) => visited.add(member.id));
    const sorted = [...component].sort((a, b) => a.id.localeCompare(b.id));
    units.push({
      id: sorted.map((member) => member.id).join("|"),
      tables: sorted,
      bounds: combineBounds(sorted.map(getTableBounds)),
    });
  }
  return units;
};

export const alignSelectedTableUnits = (
  tables: Table[],
  selectedIds: ReadonlySet<string>,
  alignment: TableAlignment,
): Table[] => {
  const units = getSelectedTableUnits(tables, selectedIds);
  if (units.length < 2) return tables;
  const selectionBounds = combineBounds(units.map((unit) => unit.bounds));
  const target = {
    left: selectionBounds.left,
    centerX: (selectionBounds.left + selectionBounds.right) / 2,
    right: selectionBounds.right,
    top: selectionBounds.top,
    centerY: (selectionBounds.top + selectionBounds.bottom) / 2,
    bottom: selectionBounds.bottom,
  }[alignment];
  const deltas = new Map<string, { x: number; y: number }>();

  units.forEach((unit) => {
    const current = {
      left: unit.bounds.left,
      centerX: (unit.bounds.left + unit.bounds.right) / 2,
      right: unit.bounds.right,
      top: unit.bounds.top,
      centerY: (unit.bounds.top + unit.bounds.bottom) / 2,
      bottom: unit.bounds.bottom,
    }[alignment];
    const horizontal = alignment === "left" || alignment === "centerX" || alignment === "right";
    unit.tables.forEach((table) =>
      deltas.set(table.id, horizontal ? { x: target - current, y: 0 } : { x: 0, y: target - current }),
    );
  });

  return tables.map((table) => {
    const delta = deltas.get(table.id);
    return delta ? { ...table, x: table.x + delta.x, y: table.y + delta.y } : table;
  });
};
