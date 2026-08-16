import React from "react";
import { Label, Tag, Text } from "react-konva";
import {
  SEAT_CALLOUT_CORNER_RADIUS_PX,
  SEAT_CALLOUT_FONT_PX,
  SEAT_CALLOUT_PADDING_PX,
  SEAT_CALLOUT_POINTER_PX,
  type SeatCalloutPointerDirection,
} from "@/lib/seatCallout";

interface SeatNameCalloutProps {
  x: number;
  y: number;
  text: string;
  pointerDirection: SeatCalloutPointerDirection;
  stageScale: number;
  opacity?: number;
}

// Shared by the hover tooltip and the persistent zoom-aware labels so guest
// names always use one visual language and Konva can size the text naturally.
export const SeatNameCallout: React.FC<SeatNameCalloutProps> = ({
  x,
  y,
  text,
  pointerDirection,
  stageScale,
  opacity = 0.9,
}) => {
  const inverseScale = 1 / Math.max(stageScale, 0.05);
  const fontSize = SEAT_CALLOUT_FONT_PX * inverseScale;
  const padding = SEAT_CALLOUT_PADDING_PX * inverseScale;
  const pointerSize = SEAT_CALLOUT_POINTER_PX * inverseScale;
  const cornerRadius = SEAT_CALLOUT_CORNER_RADIUS_PX * inverseScale;
  const shadowBlur = 6 * inverseScale;

  return (
    <Label
      x={x}
      y={y}
      opacity={opacity}
      perfectDrawEnabled={false}
      listening={false}
    >
      <Tag
        fill="#1E2218"
        pointerDirection={pointerDirection}
        pointerWidth={pointerSize}
        pointerHeight={pointerSize}
        lineJoin="round"
        shadowColor="#1E2218"
        shadowBlur={shadowBlur}
        shadowOffsetX={1 * inverseScale}
        shadowOffsetY={1 * inverseScale}
        shadowOpacity={0.3}
        cornerRadius={cornerRadius}
      />
      <Text
        text={text}
        fontFamily="'Work Sans', sans-serif"
        fontSize={fontSize}
        padding={padding}
        fill="#FAF8F0"
        fontStyle="bold"
        wrap="none"
        align="center"
        verticalAlign="middle"
      />
    </Label>
  );
};
