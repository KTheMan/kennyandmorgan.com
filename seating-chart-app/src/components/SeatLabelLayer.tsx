import React, { useMemo } from "react";
import { Text } from "react-konva";
import { useAtomValue } from "jotai";
import {
  baseShapesAtom,
  guestsAtom,
  isDraggingAtom,
  stageScaleAtom,
} from "@/lib/atoms";
import type { Table } from "@/types/seatingChart";
import { planSeatLabels } from "@/lib/seatLabels";
import { useTheme } from "@/components/ThemeProvider";

export const SeatLabelLayer: React.FC = () => {
  const shapes = useAtomValue(baseShapesAtom);
  const guests = useAtomValue(guestsAtom);
  const stageScale = useAtomValue(stageScaleAtom);
  const isDragging = useAtomValue(isDraggingAtom);
  const { theme } = useTheme();
  const tables = useMemo(
    () => shapes.filter((shape): shape is Table => shape.type === "table"),
    [shapes],
  );
  const labels = useMemo(
    () => (isDragging ? [] : planSeatLabels(tables, guests, stageScale)),
    [guests, isDragging, stageScale, tables],
  );
  const fill = theme === "dark" ? "#FAF8F0" : "#1E2218";

  return (
    <>
      {labels.map((label) => (
        <Text
          key={`${label.tableId}---${label.chairIndex}---${label.guestId}`}
          x={label.x}
          y={label.y}
          width={label.width}
          height={label.height}
          text={label.text}
          fontFamily="'Work Sans', sans-serif"
          fontSize={label.fontSize}
          fontStyle="bold"
          fill={fill}
          align="center"
          verticalAlign="middle"
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}
    </>
  );
};
