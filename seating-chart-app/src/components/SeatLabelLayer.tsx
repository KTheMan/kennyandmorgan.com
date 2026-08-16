import React, { useMemo } from "react";
import { useAtomValue } from "jotai";
import {
  baseShapesAtom,
  guestsAtom,
  hoveredSeatAtom,
  isDraggingAtom,
  stageScaleAtom,
} from "@/lib/atoms";
import type { Table } from "@/types/seatingChart";
import { planSeatLabels } from "@/lib/seatLabels";
import { SeatNameCallout } from "./SeatNameCallout";

export const SeatLabelLayer: React.FC = () => {
  const shapes = useAtomValue(baseShapesAtom);
  const guests = useAtomValue(guestsAtom);
  const stageScale = useAtomValue(stageScaleAtom);
  const isDragging = useAtomValue(isDraggingAtom);
  const hoveredSeat = useAtomValue(hoveredSeatAtom);
  const tables = useMemo(
    () => shapes.filter((shape): shape is Table => shape.type === "table"),
    [shapes],
  );
  const labels = useMemo(
    () => (isDragging ? [] : planSeatLabels(tables, guests, stageScale)),
    [guests, isDragging, stageScale, tables],
  );

  return (
    <>
      {labels
        .filter(
          (label) =>
            !hoveredSeat ||
            hoveredSeat.tableId !== label.tableId ||
            hoveredSeat.chairIndex !== label.chairIndex,
        )
        .map((label) => (
          <SeatNameCallout
            key={`${label.tableId}---${label.chairIndex}---${label.guestId}`}
            x={label.anchorX}
            y={label.anchorY}
            text={label.text}
            pointerDirection={label.pointerDirection}
            stageScale={stageScale}
          />
        ))}
    </>
  );
};
