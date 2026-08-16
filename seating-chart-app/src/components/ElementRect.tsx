import React, { useRef, useEffect, useMemo } from "react";
import { Rect, Text, Group, Transformer } from "react-konva";
import Konva from "konva";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  selectedShapeIdAtom,
  selectedTableIdsAtom,
  venueSpaceLockedAtom,
  isPanningAtom,
  renameModalStateAtom,
  editModeAtom
} from "@/lib/atoms";
import { PrimitiveAtom } from "jotai";
import { VenueElement } from "../types/seatingChart";
import { Shape } from "@/lib/atoms";
import { useTheme } from "@/components/ThemeProvider";
import { snapToGrid } from "@/lib/gridSnap";

// Direct color values for light mode — matches the wedding site's Ticket
// Show palette (cream/ink/olive).
const LIGHT_COLORS = {
  venueSpaceFill: "rgba(30, 34, 24, 0.04)", // --ink, very translucent
  venueSpaceStroke: "#1E2218", // --ink, for venue outline
  elementFill: "rgba(122, 154, 31, 0.12)", // --accent, translucent
  elementStroke: "#54604A", // --inkSoft
  elementText: "#1E2218", // --ink
  selectedStroke: "#7A9A1F", // --accent olive
  selectedShadow: "#2E3A1C", // --deep
};

// Direct color values for dark mode — mirrors the site's own dark/RSVP
// section (deep green + lime).
const DARK_COLORS = {
  venueSpaceFill: "rgba(250, 248, 240, 0.06)", // --heroInk, very translucent
  venueSpaceStroke: "#C8DC58", // --heroAccent, for venue outline
  elementFill: "rgba(156, 170, 114, 0.18)", // --heroMuted, translucent
  elementStroke: "#9CAA72", // --heroMuted
  elementText: "#FAF8F0", // --heroInk
  selectedStroke: "#C8DC58", // --heroAccent
  selectedShadow: "#1E2218", // --ink
};

interface ElementRectProps {
  shapeAtom: PrimitiveAtom<Shape>; // Accept the specific atom for this shape
}

const ElementRectContent: React.FC<{
  shapeAtom: PrimitiveAtom<VenueElement>;
}> = ({ shapeAtom }) => {
  const [shape, setShape] = useAtom(shapeAtom);
  const [selectedShapeId, setSelectedShapeId] = useAtom(selectedShapeIdAtom);
  const setSelectedTableIds = useSetAtom(selectedTableIdsAtom);
  const isPanning = useAtomValue(isPanningAtom);
  const isVenueLocked = useAtomValue(venueSpaceLockedAtom);
  const setRenameModalState = useSetAtom(renameModalStateAtom);
  const editMode = useAtomValue(editModeAtom);
  const shapeRef = useRef<Konva.Group>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const isSelected = shape.id === selectedShapeId;
  const isVenueSpace = shape.title === "Venue Space";
  const { theme } = useTheme();

  // Choose colors based on theme
  const COLORS = theme === "dark" ? DARK_COLORS : LIGHT_COLORS;

  // Effect to ensure the element color is correctly set initially and after any theme changes
  useEffect(() => {
    // Force redraw to ensure theme colors are properly applied
    if (shapeRef.current) {
      shapeRef.current.getLayer()?.batchDraw();
    }
  }, [theme]); // Re-run when theme changes

  // Draggability depends on type, panning state, global lock state, and edit mode
  const isDraggable = editMode && (
    isVenueSpace
      ? !isVenueLocked && !isPanning // Venue space only draggable if unlocked AND not panning
      : !isPanning // Other elements only non-draggable if panning
  );

  // Calculate resize enabled state for Transformer
  const isResizeEnabled = editMode && (!isVenueSpace || !isVenueLocked);

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  const handleSelect = () => {
    // Allow selection only when in edit mode
    if (!editMode) {
      return;
    }
    setSelectedTableIds(new Set());
    setSelectedShapeId(shape.id);
  };

  const handleDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    // Prevent stage drag if Alt is pressed when starting shape drag
    if (e.evt.altKey) {
      e.target.getStage()?.stopDrag();
    }
    // Also stop standard event bubbling
    e.evt.cancelBubble = true;
  };

  // Invisible-grid snapping — see lib/gridSnap. Local x/y, so it stays a
  // fixed size regardless of zoom/pan.
  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    node.x(snapToGrid(node.x()));
    node.y(snapToGrid(node.y()));
  };

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    // Update shape position only if it was intended to be draggable
    const baseDraggable = isVenueSpace ? !isVenueLocked : true;
    if (baseDraggable) {
      setShape((prev) => ({
        ...prev,
        x: snapToGrid(e.target.x()),
        y: snapToGrid(e.target.y()),
      }));
    }
  };

  const handleTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
    // Transformation implies editing, should only happen if enabled
    if (!editMode) return; 
    const node = shapeRef.current;
    if (!node) return;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    setShape((prev) => ({
      ...prev,
      x: node.x(),
      y: node.y(),
      width: Math.max(5, prev.width * scaleX),
      height: Math.max(5, prev.height * scaleY),
    }));
  };

  const handleTextDoubleClick = () => {
    if (!editMode) return; // Prevent rename in view-only mode
    setRenameModalState({
      isOpen: true,
      elementId: shape.id,
      currentTitle: shape.title,
    });
  };

  const handleTextClick = () => {
    // Allow selection, but renaming only happens if already selected AND in edit mode
    if (isSelected && editMode) {
      setRenameModalState({
        isOpen: true,
        elementId: shape.id,
        currentTitle: shape.title,
      });
    }
  };

  // Determine the fill and stroke colors based on element type, shape custom colors, and selection state
  // First check for custom colors, then fall back to theme colors if none specified
  const fillColor = isVenueSpace
    ? COLORS.venueSpaceFill
    : shape.color || COLORS.elementFill;

  const strokeColor = isVenueSpace
    ? COLORS.venueSpaceStroke
    : isSelected
      ? COLORS.selectedStroke
      : shape.stroke || COLORS.elementStroke;

  // Enhanced venue outline with proper stroke width
  const strokeWidth = isVenueSpace
    ? 2.5 // Use a value that matches our CSS variable
    : isSelected
      ? 2
      : shape.strokeWidth || 1;

  return (
    <React.Fragment>
      <Group
        ref={shapeRef}
        id={shape.id}
        x={shape.x}
        y={shape.y}
        draggable={isDraggable}
        onClick={handleSelect}
        onTap={handleSelect}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onTransformEnd={handleTransformEnd}
        listening={!isVenueSpace || isSelected}
      >
        <Rect
          width={shape.width}
          height={shape.height}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          cornerRadius={isVenueSpace ? 8 : 4}
          perfectDrawEnabled={false}
          listening={!isVenueSpace || isSelected}
          shadowBlur={isSelected ? 12 : 6}
          shadowColor={COLORS.selectedShadow}
          shadowOpacity={isSelected ? 0.4 : 0.15}
          shadowOffset={{ x: 2, y: 2 }}
        />
        {!isVenueSpace && (
          <Text
            text={shape.title}
            fontSize={14}
            fontFamily="'DM Serif Display', 'Playfair Display', serif"
            fontStyle="bold" // Added bold for better visibility
            fill={COLORS.elementText}
            align="center"
            verticalAlign="middle"
            width={shape.width}
            height={shape.height}
            listening={true}
            perfectDrawEnabled={false}
            onClick={handleTextClick}
            onDblClick={editMode ? handleTextDoubleClick : undefined}
            onDblTap={editMode ? handleTextDoubleClick : undefined}
            padding={5}
          />
        )}
      </Group>
      {isSelected && editMode && (
        <Transformer
          ref={trRef}
          resizeEnabled={isResizeEnabled}
          rotateEnabled={false}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 10 || newBox.height < 10) {
              return oldBox;
            }
            return newBox;
          }}
          keepRatio={false}
          borderStroke={COLORS.selectedStroke}
          anchorFill={isVenueSpace ? COLORS.venueSpaceFill : COLORS.elementFill}
          anchorStroke={COLORS.selectedStroke}
          anchorCornerRadius={5}
        />
      )}
    </React.Fragment>
  );
};

// Wrapper component that performs the type check *before* rendering the content
export const ElementRect: React.FC<ElementRectProps> = ({ shapeAtom }) => {
  // Read the value once here for the type check
  const shapeValue = useAtom(shapeAtom)[0];

  if (shapeValue.type !== "venue") {
    return null;
  }

  // If it's the correct type, render the content component, casting the atom type
  return (
    <ElementRectContent shapeAtom={shapeAtom as PrimitiveAtom<VenueElement>} />
  );
};
