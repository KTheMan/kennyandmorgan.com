import React, {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { Circle, Group, Label, Tag, Text } from "react-konva";
import Konva from "konva";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  modalStateAtom,
  guestsAtom,
  hoveredGuestIdAtom,
  isDraggingAtom,
  stageScaleAtom,
  editModeAtom
} from "@/lib/atoms";
import { Guest } from "../types/seatingChart";
import { useTheme } from "@/components/ThemeProvider";

interface ChairCircleProps {
  tableId: string;
  chairIndex: number;
  x: number; // Position relative to the TableCircle group center
  y: number;
  radius: number;
  guestId: string | null; // ID of the guest assigned, if any
  registerRef: (guestId: string | null, node: Konva.Group | null) => void; // Callback to register the Konva node ref
}

// Direct color values for light mode — matches the wedding site's Ticket
// Show palette (cream/ink/olive).
const LIGHT_COLORS = {
  assignedFill: "#7A9A1F", // --accent olive
  assignedStroke: "#2E3A1C", // --deep
  highlightedFill: "#C8DC58", // --heroAccent lime, pop highlight
  highlightedStroke: "#7A9A1F", // --accent olive
  unassignedFill: "#F3F0E7", // --light-gray
  unassignedStroke: "#54604A", // --inkSoft
  shadowColor: "#1E2218", // --ink
  centerDotFill: "#FFFFFF", // --surface
  centerDotStroke: "#54604A", // --inkSoft
  tooltipFill: "#1E2218", // --ink
  tooltipText: "#FAF8F0", // --bg
};

// Direct color values for dark mode — mirrors the site's own dark/RSVP
// section (deep green + lime).
const DARK_COLORS = {
  assignedFill: "#C8DC58", // --heroAccent, pops on deep green
  assignedStroke: "#1E2218", // --ink
  highlightedFill: "#E4F08A", // lightened --heroAccent
  highlightedStroke: "#FAF8F0", // --heroInk
  unassignedFill: "#3F4F2C", // lightened --heroBg
  unassignedStroke: "#9CAA72", // --heroMuted
  shadowColor: "#12160D", // near-black deep green
  centerDotFill: "#2E3A1C", // --heroBg
  centerDotStroke: "#9CAA72", // --heroMuted
  tooltipFill: "#1E2218", // --ink — tooltip chip stays dark in both themes
  tooltipText: "#FAF8F0", // --bg
};

export const ChairCircle: React.FC<ChairCircleProps> = ({
  tableId,
  chairIndex,
  x,
  y,
  radius,
  guestId,
  registerRef, // Receive the callback function
}) => {
  const [, setModalState] = useAtom(modalStateAtom);
  const [guests] = useAtom(guestsAtom);
  const currentStageScale = useAtomValue(stageScaleAtom); // Get current stage scale
  const [hoveredGuestId, setHoveredGuestId] = useAtom(hoveredGuestIdAtom); // Read and set
  const isDragging = useAtomValue(isDraggingAtom); // Read drag state
  const editMode = useAtomValue(editModeAtom); // Added
  const [isDirectlyHovered, setIsDirectlyHovered] = useState(false);
  const { theme } = useTheme();
  // Add refs for Konva objects to force updates
  const circleRef = useRef<Konva.Circle>(null);
  const chairGroupNodeRef = useRef<Konva.Group>(null); // Local ref for the main group

  // Choose colors based on theme
  const COLORS = theme === "dark" ? DARK_COLORS : LIGHT_COLORS;

  const guestNameMap = useMemo(() => {
    const map = new Map<string, string>();
    guests.forEach((guest) => {
      if (guest.id && guest.fullName) {
        map.set(guest.id, guest.fullName);
      }
    });
    return map;
  }, [guests]);

  // Determine if this chair should be highlighted (moved declaration earlier)
  const shouldHighlight =
    isDirectlyHovered || (guestId !== null && guestId === hoveredGuestId);

  // IMPORTANT: Force Konva to update when highlighting state changes (original effect)
  useEffect(() => {
    if (chairGroupNodeRef.current) {
      const layer = chairGroupNodeRef.current.getLayer();
      if (layer) {
        layer.batchDraw();
      }
    }
  }, [
    isDirectlyHovered,
    guestId,
    hoveredGuestId,
    tableId,
    chairIndex,
    shouldHighlight,
  ]); // Added shouldHighlight as it summarizes dependencies for redraw

  // New effect for moveToTop logic
  useEffect(() => {
    if (chairGroupNodeRef.current) {
      if (shouldHighlight) {
        chairGroupNodeRef.current.moveToTop();
      }
      // Ensure layer is redrawn if moveToTop happened or if tooltip visibility changes.
      const layer = chairGroupNodeRef.current.getLayer();
      if (layer) {
        layer.batchDraw(); // This batchDraw might be redundant if the one above catches all changes
      }
    }
  }, [shouldHighlight]);

  const handleClick = () => {
    if (!editMode) return; // Prevent opening modal in view-only mode

    const uniqueChairId = `${tableId}---${chairIndex}`;
    setModalState({
      isOpen: true,
      chairId: uniqueChairId,
      guestId: guestId,
    });
  };

  const handleMouseEnter = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (isDragging) return; // Don't trigger hover if dragging

    setIsDirectlyHovered(true);

    // Update hoveredGuestId to enable bidirectional highlighting
    if (guestId) {
      // When hovering over a chair with a guest, highlight that guest in sidebar
      setHoveredGuestId(guestId);
    }

    // Only change cursor if editable
    if (editMode) {
      const stage = e.target.getStage();
      if (stage) {
        stage.container().style.cursor = "pointer";
      }
    }
  };

  const handleMouseLeave = (e: Konva.KonvaEventObject<MouseEvent>) => {
    // No need to check isDragging here, always remove direct hover state
    setIsDirectlyHovered(false);

    // Clear hoveredGuestId when mouse leaves a chair with a guest
    if (guestId && hoveredGuestId === guestId) {
      // Only clear if it matches this chair's guest
      setHoveredGuestId(null);
    }

    // Always reset cursor on leave
    const stage = e.target.getStage();
    if (stage) {
      stage.container().style.cursor = "default";
    }
  };

  const guestName = guestId
    ? guestNameMap.get(guestId) || "Unknown Guest"
    : "Empty Seat";

  // Tooltip specific calculations based on stage scale
  const tooltipBaseFontSize = 12;
  const tooltipBasePadding = 6;
  const tooltipBasePointerWidth = 8;
  const tooltipBasePointerHeight = 8;
  const tooltipBaseCornerRadius = 4;
  const tooltipBaseShadowBlur = 6;

  const ttScale = currentStageScale !== 0 ? 1 / currentStageScale : 1; // Inverse scale for tooltip elements

  const tooltipFontSize = tooltipBaseFontSize * ttScale;
  const tooltipPadding = tooltipBasePadding * ttScale;
  const tooltipPointerWidth = tooltipBasePointerWidth * ttScale;
  const tooltipPointerHeight = tooltipBasePointerHeight * ttScale;
  const tooltipCornerRadius = tooltipBaseCornerRadius * ttScale;
  const tooltipShadowBlur = tooltipBaseShadowBlur * ttScale;
  const tooltipYOffset = (radius + tooltipPointerHeight + 5) * ttScale * 0.85; // Position above the chair, scaled and 15% lower

  // Determine fill and stroke colors based on state
  const fillColor = guestId
    ? shouldHighlight
      ? COLORS.highlightedFill
      : COLORS.assignedFill
    : isDirectlyHovered
      ? COLORS.highlightedFill
      : COLORS.unassignedFill;

  const strokeColor = guestId
    ? shouldHighlight
      ? COLORS.highlightedStroke
      : COLORS.assignedStroke
    : isDirectlyHovered
      ? COLORS.highlightedStroke
      : COLORS.unassignedStroke;

  // Enhanced animation for highlighted state - increased for better visibility
  const visualScale = shouldHighlight ? 1.35 : 1;
  const shadowOpacity = shouldHighlight ? 0.65 : guestId ? 0.35 : 0.2;
  const shadowBlur = shouldHighlight ? 15 : guestId ? 8 : 4;
  const strokeWidth = guestId ? (shouldHighlight ? 3 : 2.5) : 1.5; // Thicker border for occupied seats

  // Added distinct indicator for assigned chairs
  const showCenterDot = guestId !== null;

  // Ref callback for the main group
  const combinedRefCallback = useCallback(
    (node: Konva.Group | null) => {
      chairGroupNodeRef.current = node; // Assign to our local ref
      if (registerRef) {
        // Call the prop from parent
        registerRef(guestId, node);
      }
    },
    [guestId, registerRef],
  );

  return (
    <Group
      x={x}
      y={y}
      // Use the callback ref pattern here
      ref={combinedRefCallback}
      guestId={guestId} // Keep guestId attribute for direct hover logic if needed
      name={`chair-${tableId}-${chairIndex}`}
      // Add radius attribute for positioning calculations
      radius={radius}
    >
      <Circle
        ref={circleRef}
        radius={radius}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        scaleX={visualScale}
        scaleY={visualScale}
        shadowBlur={shadowBlur}
        shadowColor={COLORS.shadowColor}
        shadowOpacity={shadowOpacity}
        shadowOffset={{ x: 1, y: 1 }}
        offsetX={0}
        offsetY={0}
        // Only attach click listener if in edit mode
        onClick={editMode ? handleClick : undefined}
        onTap={editMode ? handleClick : undefined}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        perfectDrawEnabled={false}
      />

      {/* Enhanced indicator for occupied seats */}
      {showCenterDot && (
        <Circle
          radius={radius / 2.5}
          fill={COLORS.centerDotFill}
          strokeWidth={1}
          stroke={COLORS.centerDotStroke}
          offsetX={0}
          offsetY={0}
          perfectDrawEnabled={false}
          listening={false}
          scaleX={shouldHighlight ? 1.2 : 1}
          scaleY={shouldHighlight ? 1.2 : 1}
        />
      )}

      {/* Tooltip Label - only visible when highlighted */}
      {shouldHighlight && (
        <Label
          x={0} // Centered relative to the chair group
          y={-tooltipYOffset} // Positioned above the chair
          offsetX={0} // Will be adjusted by text width if needed, but Konva Label handles this for simple cases
          opacity={0.9}
          perfectDrawEnabled={false}
          listening={false} // Tooltip should not capture mouse events
        >
          <Tag
            fill={COLORS.tooltipFill}
            pointerDirection={"down"} // Points down towards the chair
            pointerWidth={tooltipPointerWidth}
            pointerHeight={tooltipPointerHeight}
            lineJoin={"round"}
            shadowColor={COLORS.shadowColor}
            shadowBlur={tooltipShadowBlur}
            shadowOffsetX={1 * ttScale}
            shadowOffsetY={1 * ttScale}
            shadowOpacity={0.3}
            cornerRadius={tooltipCornerRadius}
            // Padding is applied by Text element below for better text measurement handling
          />
          <Text
            text={guestName}
            fontFamily="'Work Sans', sans-serif"
            fontSize={tooltipFontSize}
            padding={tooltipPadding}
            fill={COLORS.tooltipText}
            fontStyle="bold"
            align="center"
            verticalAlign="middle"
          />
        </Label>
      )}
    </Group>
  );
};
