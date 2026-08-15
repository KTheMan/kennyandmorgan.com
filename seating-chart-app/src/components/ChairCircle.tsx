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
  editModeAtom,
  baseShapesAtom,
} from "@/lib/atoms";
import { Guest, Table } from "../types/seatingChart";
import { useTheme } from "@/components/ThemeProvider";
import { useToast } from "@/components/ui/use-toast";

interface ChairCircleProps {
  tableId: string;
  chairIndex: number;
  x: number; // Position relative to the TableCircle group center
  y: number;
  radius: number;
  guestId: string | null; // ID of the guest assigned, if any
  registerRef: (guestId: string | null, node: Konva.Group | null) => void; // Callback to register the Konva node ref
  // Set while a party is being dragged and this seat is where the Nth
  // guest in that party would land if dropped right now — purely a live
  // preview, never persisted. Only ever set on empty seats.
  previewOrder?: number | null;
  // Whether this seat's table has its seating arrangement locked (see
  // Table.seatingLocked) — blocks both click-to-assign and drag-to-move
  // for this chair, whether it's occupied or empty.
  seatingLocked?: boolean;
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
  previewFill: "rgba(122, 154, 31, 0.22)", // translucent --accent
  previewStroke: "#7A9A1F", // --accent olive
  previewNumberText: "#2E3A1C", // --deep
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
  previewFill: "rgba(200, 220, 88, 0.22)", // translucent --heroAccent
  previewStroke: "#C8DC58", // --heroAccent
  previewNumberText: "#1E2218", // --ink
};

export const ChairCircle: React.FC<ChairCircleProps> = ({
  tableId,
  chairIndex,
  x,
  y,
  radius,
  guestId,
  registerRef, // Receive the callback function
  previewOrder = null,
  seatingLocked = false,
}) => {
  const [, setModalState] = useAtom(modalStateAtom);
  const [guests, setGuests] = useAtom(guestsAtom);
  const baseShapes = useAtomValue(baseShapesAtom);
  const currentStageScale = useAtomValue(stageScaleAtom); // Get current stage scale
  const [hoveredGuestId, setHoveredGuestId] = useAtom(hoveredGuestIdAtom); // Read and set
  const [isDragging, setIsDragging] = useAtom(isDraggingAtom); // Read/set drag state
  const editMode = useAtomValue(editModeAtom); // Added
  const [isDirectlyHovered, setIsDirectlyHovered] = useState(false);
  const { theme } = useTheme();
  const { toast } = useToast();
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
    if (!editMode || seatingLocked) return; // Prevent opening modal in view-only mode or while this table's seating is locked

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
        stage.container().style.cursor = seatingLocked
          ? "not-allowed"
          : guestId
            ? "grab" // occupied + unlocked: draggable to another seat
            : "pointer"; // empty: click to assign
      }
    }
  };

  // Dragging an occupied, unlocked seat moves just this chair (see
  // draggable on the Group below) — independent of the table's own
  // position lock, which only governs dragging the table as a whole.
  // Konva starts the drag on whichever node under the pointer is
  // draggable, walking up from the event target, so setting it here
  // takes precedence over the table Group's draggable without any extra
  // coordination.
  const handleChairDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    setIsDragging(true);
    e.target.moveToTop();
  };

  // No-op beyond stopping propagation: the table's own onDragMove (grid
  // snapping) would otherwise fire for this chair too, since Konva drag
  // events bubble up the node tree by default. This chair doesn't need
  // grid snapping — its position is reset on drop regardless (see
  // handleChairDragEnd), free movement in between just looks natural.
  const handleChairDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
  };

  const handleChairDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    setIsDragging(false);
    const node = e.target;
    const stage = node.getStage();
    const pointerPos = stage?.getPointerPosition() ?? null;

    // This chair's screen position is derived from the table's layout
    // (the x/y props), not free-floating — always snap the node back;
    // an actual move happens through the guests atom below, which
    // re-renders this chair (and the target chair) at their real spots.
    node.position({ x, y });

    if (!stage || !pointerPos || !guestId) return;

    // Hit-test excluding this node itself, so dropping back onto your own
    // seat (or very near it) doesn't misresolve to something else.
    node.hide();
    let hit: Konva.Node | null = stage.getIntersection(pointerPos);
    node.show();

    let targetTableId: string | null = null;
    let targetChairIndex: number | null = null;
    while (hit && hit !== stage) {
      const ci = hit.getAttr("chairIndex");
      const ti = hit.getAttr("tableId");
      if (typeof ci === "number" && typeof ti === "string") {
        targetTableId = ti;
        targetChairIndex = ci;
        break;
      }
      hit = hit.getParent();
    }

    if (targetTableId === null || targetChairIndex === null) return; // dropped somewhere that isn't a seat
    if (targetTableId === tableId && targetChairIndex === chairIndex) return; // dropped back on itself

    const targetTable = baseShapes.find(
      (s): s is Table => s.type === "table" && s.id === targetTableId,
    );
    if (targetTable?.seatingLocked) {
      toast({
        title: "Seating Locked",
        description: `Table ${targetTable.number}'s seating is locked. Unlock it from the sidebar guest list to rearrange guests.`,
        variant: "destructive",
      });
      return;
    }

    const occupant = guests.find(
      (g) => g.tableId === targetTableId && g.chairIndex === targetChairIndex,
    );

    setGuests((prev) =>
      prev.map((g) => {
        if (g.id === guestId) {
          return { ...g, tableId: targetTableId!, chairIndex: targetChairIndex! };
        }
        if (occupant && g.id === occupant.id) {
          // Swap: the displaced guest takes this chair's old seat.
          return { ...g, tableId, chairIndex };
        }
        return g;
      }),
    );
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

  // Determine fill and stroke colors based on state. Preview wins over
  // hover — you can't be "directly hovering" a seat mid-drag anyway,
  // since the pointer is busy dragging the party pill.
  const fillColor = previewOrder
    ? COLORS.previewFill
    : guestId
      ? shouldHighlight
        ? COLORS.highlightedFill
        : COLORS.assignedFill
      : isDirectlyHovered
        ? COLORS.highlightedFill
        : COLORS.unassignedFill;

  const strokeColor = previewOrder
    ? COLORS.previewStroke
    : guestId
      ? shouldHighlight
        ? COLORS.highlightedStroke
        : COLORS.assignedStroke
      : isDirectlyHovered
        ? COLORS.highlightedStroke
        : COLORS.unassignedStroke;

  // Enhanced animation for highlighted state - increased for better visibility
  const visualScale = shouldHighlight ? 1.35 : previewOrder ? 1.15 : 1;
  const shadowOpacity = shouldHighlight ? 0.65 : guestId ? 0.35 : 0.2;
  const shadowBlur = shouldHighlight ? 15 : guestId ? 8 : 4;
  const strokeWidth = previewOrder ? 2 : guestId ? (shouldHighlight ? 3 : 2.5) : 1.5; // Thicker border for occupied seats

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
      // Explicit attrs (not just parsed out of `name`, which can't be split
      // reliably since tableId itself contains hyphens) — read back by the
      // canvas drop-zone's hit-test in SeatingChartApp to resolve exactly
      // which chair a dragged guest was dropped on.
      tableId={tableId}
      chairIndex={chairIndex}
      // Add radius attribute for positioning calculations
      radius={radius}
      // Only occupied, unlocked seats are draggable — an empty seat's
      // group stays non-draggable so a click-drag there still falls
      // through to the table's own draggable (moving the whole table),
      // exactly as before this feature existed.
      draggable={editMode && guestId !== null && !seatingLocked}
      onDragStart={handleChairDragStart}
      onDragMove={handleChairDragMove}
      onDragEnd={handleChairDragEnd}
    >
      <Circle
        ref={circleRef}
        radius={radius}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        dash={previewOrder ? [3, 3] : undefined}
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
        listening={!previewOrder}
      />

      {/* Live preview marker while a party is being dragged toward this
          seat — a ghost/dashed ring with the guest's place in the group's
          drop order, cleared the instant the drag ends either way. */}
      {previewOrder && (
        <Text
          text={String(previewOrder)}
          fontSize={radius * 1.15}
          fontStyle="bold"
          fill={COLORS.previewNumberText}
          width={radius * 2}
          height={radius * 2}
          align="center"
          verticalAlign="middle"
          offsetX={radius}
          offsetY={radius}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}

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
