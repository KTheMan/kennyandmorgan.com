import React from "react";
import { Label, Tag, Text } from "react-konva";
import Konva from "konva";
import { useAtomValue } from "jotai";
import {
  hoveredSeatAtom,
  guestsAtom,
  stageScaleAtom,
  isDraggingAtom,
} from "@/lib/atoms";
import { CHAIR_RADIUS } from "@/lib/tableSeating";

// The tooltip chip's fill/text colors are the same in both themes (a dark
// chip reads fine on either background) — see the comment that used to sit
// next to these in ChairCircle.tsx, before the tooltip moved here.
const TOOLTIP_FILL = "#1E2218"; // --ink
const TOOLTIP_TEXT = "#FAF8F0"; // --bg

interface SeatTooltipLayerProps {
  // Live Konva.Group node for every rendered chair (occupied or empty),
  // keyed by `${tableId}---${chairIndex}` — populated by ChairCircle's
  // registerRef as chairs mount/unmount. We read the hovered one's actual
  // on-canvas transform rather than recomputing table layout math here, so
  // this always matches what's drawn regardless of table position, zoom,
  // or rotation.
  chairNodes: React.MutableRefObject<Record<string, Konva.Group>>;
}

// Draws the single name-tag tooltip for whichever seat is currently
// hovered, in its own Layer stacked above every table. Each chair used to
// draw its own tooltip as a child of its own table's Group, so a
// neighboring table rendered later in the shapes list could paint right
// over it — hoisting it up here means it's always on top, full stop.
export const SeatTooltipLayer: React.FC<SeatTooltipLayerProps> = ({
  chairNodes,
}) => {
  const hoveredSeat = useAtomValue(hoveredSeatAtom);
  const guests = useAtomValue(guestsAtom);
  const currentStageScale = useAtomValue(stageScaleAtom);
  const isDragging = useAtomValue(isDraggingAtom);

  // We only recompute the tooltip's position on render, not every Konva
  // frame — fine for a static hover, but it'd go stale while something is
  // mid-drag (a table dragged by an empty seat, say). Simplest fix: don't
  // show it during any canvas drag.
  if (!hoveredSeat || isDragging) return null;

  const node = chairNodes.current[`${hoveredSeat.tableId}---${hoveredSeat.chairIndex}`];
  if (!node) return null;

  const stage = node.getStage();
  if (!stage) return null;

  const guest = guests.find(
    (g) =>
      g.tableId === hoveredSeat.tableId &&
      g.chairIndex === hoveredSeat.chairIndex,
  );
  const guestName = guest?.fullName || "Empty Seat";

  // Position relative to the Stage, excluding the Stage's own pan/zoom
  // transform (passing it as `top` stops the walk there) — exactly the
  // coordinate space this sibling Layer renders in, since neither Layer
  // carries a transform of its own; the Stage's pan/zoom then applies
  // uniformly to both, same as it always has for the tables layer.
  const anchor = node.getAbsoluteTransform(stage).point({ x: 0, y: 0 });

  // The chair itself never carries its own rotation — only the table does
  // — so the chair's absolute rotation IS the table's rotation, applied on
  // top of this seat's fixed outward-facing angle to get the true
  // world-space direction "away from the table" for this specific seat.
  const tableRotationRad = (node.getAbsoluteRotation() * Math.PI) / 180;
  const localOutwardAngle =
    (node.getAttr("outwardAngle") as number | undefined) ?? -Math.PI / 2;
  const worldAngle = localOutwardAngle + tableRotationRad;
  const outwardX = Math.cos(worldAngle);
  const outwardY = Math.sin(worldAngle);

  // Snap the tag's pointer to whichever cardinal direction best faces back
  // toward the chair (the "inward" vector, i.e. -outward), so the tail
  // never reads as pointing into the table even for a seat on the bottom
  // or rotated side of a table. The guest name itself is never rotated —
  // only the pointer direction changes — so it always stays upright.
  const inwardX = -outwardX;
  const inwardY = -outwardY;
  const pointerDirection: "up" | "down" | "left" | "right" =
    Math.abs(inwardY) >= Math.abs(inwardX)
      ? inwardY > 0
        ? "down"
        : "up"
      : inwardX > 0
        ? "right"
        : "left";

  // Inverse-scale everything so the tooltip stays a constant apparent size
  // on screen regardless of canvas zoom.
  const ttScale = currentStageScale !== 0 ? 1 / currentStageScale : 1;
  const fontSize = 12 * ttScale;
  const padding = 6 * ttScale;
  const pointerSize = 8 * ttScale;
  const cornerRadius = 4 * ttScale;
  const shadowBlur = 6 * ttScale;
  // Clears the chair's own radius, plus a little breathing room, before
  // the tag body starts — same distance ChairCircle always used, just now
  // applied along the seat's real outward direction instead of always up.
  const offsetDistance = (CHAIR_RADIUS + pointerSize + 5) * ttScale * 0.85;

  return (
    <Label
      x={anchor.x + outwardX * offsetDistance}
      y={anchor.y + outwardY * offsetDistance}
      opacity={0.9}
      perfectDrawEnabled={false}
      listening={false}
    >
      <Tag
        fill={TOOLTIP_FILL}
        pointerDirection={pointerDirection}
        pointerWidth={pointerSize}
        pointerHeight={pointerSize}
        lineJoin="round"
        shadowColor={TOOLTIP_FILL}
        shadowBlur={shadowBlur}
        shadowOffsetX={1 * ttScale}
        shadowOffsetY={1 * ttScale}
        shadowOpacity={0.3}
        cornerRadius={cornerRadius}
      />
      <Text
        text={guestName}
        fontFamily="'Work Sans', sans-serif"
        fontSize={fontSize}
        padding={padding}
        fill={TOOLTIP_TEXT}
        fontStyle="bold"
        align="center"
        verticalAlign="middle"
      />
    </Label>
  );
};
