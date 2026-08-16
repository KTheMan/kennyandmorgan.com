import type { Guest, Table } from "../types/seatingChart";
import {
  CHAIR_RADIUS,
  computeTableChairPositions,
} from "./tableSeating";

const LABEL_FONT_PX = 11;
const LABEL_HEIGHT_PX = 15;
const LABEL_GAP_PX = 4;
const COLLISION_PADDING_PX = 2;

interface Point {
  x: number;
  y: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SeatCandidate {
  guestId: string;
  tableId: string;
  chairIndex: number;
  chair: Point;
  outward: Point;
  variants: string[];
}

export interface PlannedSeatLabel extends Box {
  guestId: string;
  tableId: string;
  chairIndex: number;
  text: string;
  fontSize: number;
}

const rotatePoint = (point: Point, radians: number): Point => ({
  x: point.x * Math.cos(radians) - point.y * Math.sin(radians),
  y: point.x * Math.sin(radians) + point.y * Math.cos(radians),
});

export const getGuestLabelVariants = (fullName: string): string[] => {
  const normalized = fullName.trim().replace(/\s+/g, " ");
  if (!normalized) return [];
  const parts = normalized.split(" ");
  const first = parts[0];
  const last = parts[parts.length - 1];
  const short = parts.length > 1 ? `${first[0].toUpperCase()}. ${last}` : first;
  const initials =
    parts.length > 1
      ? `${first[0]}${last[0]}`.toUpperCase()
      : first[0].toUpperCase();
  return [...new Set([normalized, short, initials])];
};

// Work Sans at 11px is close to six pixels per ordinary character. The
// small per-character adjustment is accurate enough for collision planning
// without constructing hundreds of temporary Konva.Text nodes on every zoom.
const estimateTextWidthPx = (text: string): number =>
  Math.ceil(
    [...text].reduce((width, character) => {
      if (character === " ") return width + 3.2;
      if (/[ilI.,'’]/.test(character)) return width + 3.1;
      if (/[MW@]/.test(character)) return width + 8.4;
      if (/[A-Z]/.test(character)) return width + 6.8;
      return width + 5.6;
    }, 4),
  );

const buildLabelBox = (
  candidate: SeatCandidate,
  text: string,
  scale: number,
): Box => {
  const width = estimateTextWidthPx(text) / scale;
  const height = LABEL_HEIGHT_PX / scale;
  const gap = LABEL_GAP_PX / scale;
  const seatRadius = CHAIR_RADIUS;
  const horizontal = Math.abs(candidate.outward.x) >= Math.abs(candidate.outward.y);

  if (horizontal) {
    const rightFacing = candidate.outward.x >= 0;
    return {
      x: rightFacing
        ? candidate.chair.x + seatRadius + gap
        : candidate.chair.x - seatRadius - gap - width,
      y: candidate.chair.y - height / 2,
      width,
      height,
    };
  }

  const downFacing = candidate.outward.y >= 0;
  return {
    x: candidate.chair.x - width / 2,
    y: downFacing
      ? candidate.chair.y + seatRadius + gap
      : candidate.chair.y - seatRadius - gap - height,
    width,
    height,
  };
};

const boxesIntersect = (a: Box, b: Box, padding: number): boolean =>
  a.x < b.x + b.width + padding &&
  a.x + a.width + padding > b.x &&
  a.y < b.y + b.height + padding &&
  a.y + a.height + padding > b.y;

const boxIntersectsCircle = (
  box: Box,
  center: Point,
  radius: number,
): boolean => {
  const closestX = Math.max(box.x, Math.min(center.x, box.x + box.width));
  const closestY = Math.max(box.y, Math.min(center.y, box.y + box.height));
  return Math.hypot(center.x - closestX, center.y - closestY) < radius;
};

const boxIntersectsTable = (box: Box, table: Table, padding: number): boolean => {
  if (table.shape !== "rectangle") {
    return boxIntersectsCircle(box, { x: table.x, y: table.y }, table.radius + padding);
  }

  // Separating-axis test between the label's world-axis box and the table's
  // oriented rectangle. This avoids the overly conservative empty corners of
  // a rotated table's axis-aligned bounding box.
  const labelCenter = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
  const labelHalf = { x: box.width / 2, y: box.height / 2 };
  const tableHalf = {
    x: (table.width ?? table.radius * 2) / 2 + padding,
    y: (table.height ?? table.radius * 2) / 2 + padding,
  };
  const radians = ((table.rotation ?? 0) * Math.PI) / 180;
  const tableX = { x: Math.cos(radians), y: Math.sin(radians) };
  const tableY = { x: -Math.sin(radians), y: Math.cos(radians) };
  const delta = { x: labelCenter.x - table.x, y: labelCenter.y - table.y };
  const absCos = Math.abs(tableX.x);
  const absSin = Math.abs(tableX.y);

  if (
    Math.abs(delta.x) >
    labelHalf.x + tableHalf.x * absCos + tableHalf.y * absSin
  ) return false;
  if (
    Math.abs(delta.y) >
    labelHalf.y + tableHalf.x * absSin + tableHalf.y * absCos
  ) return false;
  if (
    Math.abs(delta.x * tableX.x + delta.y * tableX.y) >
    tableHalf.x + labelHalf.x * absCos + labelHalf.y * absSin
  ) return false;
  if (
    Math.abs(delta.x * tableY.x + delta.y * tableY.y) >
    tableHalf.y + labelHalf.x * absSin + labelHalf.y * absCos
  ) return false;
  return true;
};

export const planSeatLabels = (
  tables: Table[],
  guests: Guest[],
  stageScale: number,
): PlannedSeatLabel[] => {
  const scale = Math.max(stageScale, 0.05);
  const guestsBySeat = new Map(
    guests
      .filter((guest) => guest.tableId && typeof guest.chairIndex === "number")
      .map((guest) => [`${guest.tableId}---${guest.chairIndex}`, guest]),
  );
  const chairs: Array<Point & { tableId: string; chairIndex: number }> = [];
  const candidates: SeatCandidate[] = [];

  [...tables]
    .sort((a, b) => a.number - b.number || a.id.localeCompare(b.id))
    .forEach((table) => {
      const radians = ((table.rotation ?? 0) * Math.PI) / 180;
      computeTableChairPositions(table).forEach((position, chairIndex) => {
        const rotated = rotatePoint(position, radians);
        const chair = { x: table.x + rotated.x, y: table.y + rotated.y };
        chairs.push({ ...chair, tableId: table.id, chairIndex });
        const guest = guestsBySeat.get(`${table.id}---${chairIndex}`);
        if (!guest) return;
        const outwardAngle = position.angle + radians;
        candidates.push({
          guestId: guest.id,
          tableId: table.id,
          chairIndex,
          chair,
          outward: { x: Math.cos(outwardAngle), y: Math.sin(outwardAngle) },
          variants: getGuestLabelVariants(guest.fullName),
        });
      });
    });

  const padding = COLLISION_PADDING_PX / scale;
  const isClearOfFixedGeometry = (box: Box, candidate: SeatCandidate) =>
    !tables.some((table) => boxIntersectsTable(box, table, padding)) &&
    !chairs.some(
      (chair) =>
        !(chair.tableId === candidate.tableId && chair.chairIndex === candidate.chairIndex) &&
        boxIntersectsCircle(box, chair, CHAIR_RADIUS + padding),
    );

  // First reserve the smallest possible label for as many occupied seats as
  // possible. Then expand each reservation to the longest form that still
  // clears every neighboring label and piece of table geometry.
  const accepted: Array<{
    candidate: SeatCandidate;
    text: string;
    box: Box;
  }> = [];
  candidates.forEach((candidate) => {
    const initials = candidate.variants[candidate.variants.length - 1];
    if (!initials) return;
    const box = buildLabelBox(candidate, initials, scale);
    if (!isClearOfFixedGeometry(box, candidate)) return;
    if (accepted.some((label) => boxesIntersect(box, label.box, padding))) return;
    accepted.push({ candidate, text: initials, box });
  });

  accepted.forEach((label, labelIndex) => {
    for (const text of label.candidate.variants) {
      const box = buildLabelBox(label.candidate, text, scale);
      if (!isClearOfFixedGeometry(box, label.candidate)) continue;
      const collides = accepted.some(
        (other, otherIndex) =>
          otherIndex !== labelIndex && boxesIntersect(box, other.box, padding),
      );
      if (!collides) {
        label.text = text;
        label.box = box;
        break;
      }
    }
  });

  return accepted.map(({ candidate, text, box }) => ({
    ...box,
    guestId: candidate.guestId,
    tableId: candidate.tableId,
    chairIndex: candidate.chairIndex,
    text,
    fontSize: LABEL_FONT_PX / scale,
  }));
};
