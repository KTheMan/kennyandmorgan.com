import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Circle, Group, Text } from "react-konva";
import Konva from "konva";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { selectAtom } from "jotai/utils";
import {
  modalStateAtom,
  guestsAtom,
  hoveredGuestIdAtom,
  hoveredSeatAtom,
  isDraggingAtom,
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
  // Outward-facing angle (radians, table-local/unrotated frame) this seat
  // sits at — e.g. -Math.PI/2 for a seat on a round table's top edge. Used
  // only to tell the top-level seat-name tooltip which direction "away
  // from the table" is for this seat; see SeatTooltipLayer.
  angle: number;
  // Registers this chair's Konva Group under `${tableId}---${chairIndex}`
  // — every seat registers, not just occupied ones — so SeatTooltipLayer
  // can look up any hovered chair's live on-canvas position/rotation.
  registerRef: (
    tableId: string,
    chairIndex: number,
    node: Konva.Group | null,
  ) => void;
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
  angle,
  registerRef, // Receive the callback function
  previewOrder = null,
  seatingLocked = false,
}) => {
  const store = useStore();
  const setModalState = useSetAtom(modalStateAtom);
  const setGuests = useSetAtom(guestsAtom);
  const isExternallyHighlightedAtom = useMemo(
    () =>
      selectAtom(
        hoveredGuestIdAtom,
        (hoveredGuestId) => guestId !== null && hoveredGuestId === guestId,
      ),
    [guestId],
  );
  const isExternallyHighlighted = useAtomValue(isExternallyHighlightedAtom);
  const setHoveredGuestId = useSetAtom(hoveredGuestIdAtom);
  const setHoveredSeat = useSetAtom(hoveredSeatAtom);
  const setIsDragging = useSetAtom(isDraggingAtom);
  const editMode = useAtomValue(editModeAtom); // Added
  const [isDirectlyHovered, setIsDirectlyHovered] = useState(false);
  const { theme } = useTheme();
  const { toast } = useToast();
  // Add refs for Konva objects to force updates
  const circleRef = useRef<Konva.Circle>(null);
  const chairGroupNodeRef = useRef<Konva.Group>(null); // Local ref for the main group

  // Choose colors based on theme
  const COLORS = theme === "dark" ? DARK_COLORS : LIGHT_COLORS;

  // Determine if this chair should be highlighted (moved declaration earlier)
  const shouldHighlight =
    isDirectlyHovered || isExternallyHighlighted;

  // react-konva redraws changed props itself. The only imperative work needed
  // on highlight is preserving the highlighted chair's z-order.
  useEffect(() => {
    if (!shouldHighlight || !chairGroupNodeRef.current) return;
    chairGroupNodeRef.current.moveToTop();
    chairGroupNodeRef.current.getLayer()?.batchDraw();
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
    if (store.get(isDraggingAtom)) return; // Don't trigger hover if dragging

    setIsDirectlyHovered(true);
    setHoveredSeat({ tableId, chairIndex });

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

  // Only the occupant marker is draggable. The outer chair group remains at
  // its table-defined position so the seat itself never follows the pointer.
  const handleChairPointerDown = (
    e: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ) => {
    // The table group can also be draggable. Keep this pointer-down from
    // reaching it so Konva registers only the occupant marker as the drag
    // source, never the table or fixed chair behind it.
    e.cancelBubble = true;
  };

  const handleChairDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    setIsDragging(true);
    e.target.moveToTop();
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = "grabbing";
    // Drop the name tooltip rather than let it trail a chair mid-drag —
    // it's keyed to this chair's resting position, not the pointer.
    setHoveredSeat(null);
  };

  // Stop the nested marker's drag from reaching the table drag handlers.
  const handleChairDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
  };

  const handleChairDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    setIsDragging(false);
    const node = e.target;
    const stage = node.getStage();
    const pointerPos = stage?.getPointerPosition() ?? null;
    const layer = node.getLayer();

    // Exclude the dragged marker from Konva's hit canvas before resolving
    // the drop target. Merely hiding it is not enough: getIntersection reads
    // the already-rendered hit canvas, which otherwise still contains the
    // marker at the pointer and resolves every drop back to the source seat.
    node.hide();
    layer?.drawHit();
    let hit: Konva.Node | null =
      stage && pointerPos ? stage.getIntersection(pointerPos) : null;

    // The marker lives at (0, 0) inside the fixed chair group. Always return
    // it there; changing guest assignments below causes the correct source
    // and target markers to render on their respective seats.
    node.position({ x: 0, y: 0 });
    node.show();
    layer?.drawHit();
    layer?.batchDraw();
    if (stage) stage.container().style.cursor = "grab";

    if (!stage || !pointerPos || !guestId) return;

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

    const targetTable = store.get(baseShapesAtom).find(
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

    const occupant = store.get(guestsAtom).find(
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
    if (guestId) {
      setHoveredGuestId((hoveredGuestId) =>
        hoveredGuestId === guestId ? null : hoveredGuestId,
      );
    }

    // Only clear if it matches this chair, so a leave that fires after the
    // next chair's enter (ordering isn't guaranteed) can't clobber it.
    setHoveredSeat((prev) =>
      prev && prev.tableId === tableId && prev.chairIndex === chairIndex
        ? null
        : prev,
    );

    // Always reset cursor on leave
    const stage = e.target.getStage();
    if (stage) {
      stage.container().style.cursor = "default";
    }
  };

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
        registerRef(tableId, chairIndex, node);
      }
    },
    [tableId, chairIndex, registerRef],
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
      // Read back by SeatTooltipLayer to know which way "away from the
      // table" is for this seat, combined with the table's own rotation.
      outwardAngle={angle}
      onClick={editMode ? handleClick : undefined}
      onTap={editMode ? handleClick : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
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
        shadowEnabled={shouldHighlight}
        shadowOffset={{ x: 1, y: 1 }}
        offsetX={0}
        offsetY={0}
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

      {/* The occupant marker moves independently; the chair circle above
          remains fixed at the seat's table-defined position. The transparent
          hit circle keeps the marker easy to grab without changing its look. */}
      {showCenterDot && (
        <Group
          name={`occupant-${guestId}`}
          draggable={editMode && !seatingLocked}
          onMouseDown={handleChairPointerDown}
          onTouchStart={handleChairPointerDown}
          onDragStart={handleChairDragStart}
          onDragMove={handleChairDragMove}
          onDragEnd={handleChairDragEnd}
        >
          <Circle radius={radius * 0.72} fill="rgba(0,0,0,0.001)" />
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
        </Group>
      )}
    </Group>
  );
};
