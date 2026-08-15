import React, { useEffect, useRef } from "react";
import { Image as KonvaImage, Transformer } from "react-konva";
import useImage from "use-image";
import Konva from "konva";
import { useAtom, useAtomValue } from "jotai";
import { selectedShapeIdAtom, editModeAtom } from "@/lib/atoms";
import { PrimitiveAtom } from "jotai";
import { BackgroundImage } from "../types/seatingChart";
import { Shape } from "@/lib/atoms";
import { snapToGrid } from "@/lib/gridSnap";

// How far a resize can shrink or grow the image, relative to its own
// natural size — generous enough for "tiny reference thumbnail" up to
// "way oversized," but keeps it from vanishing to nothing or growing to
// something absurd that makes the shape hard to find/select again.
const MIN_SCALE = 0.05;
const MAX_SCALE = 10;

interface BackgroundImageShapeProps {
  shapeAtom: PrimitiveAtom<Shape>;
}

const BackgroundImageShapeContent: React.FC<{
  shapeAtom: PrimitiveAtom<BackgroundImage>;
}> = ({ shapeAtom }) => {
  const [shape, setShape] = useAtom(shapeAtom);
  const [selectedShapeId, setSelectedShapeId] = useAtom(selectedShapeIdAtom);
  const editMode = useAtomValue(editModeAtom);
  const shapeRef = useRef<Konva.Image>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const isSelected = shape.id === selectedShapeId;
  const isLocked = shape.locked === true;

  const [htmlImage] = useImage(shape.dataUrl);

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  // Like the venue space shape, this only listens for pointer events while
  // already selected — otherwise, being a large shape that can cover the
  // whole floor, it would eat clicks/drags meant for tables sitting near
  // or on top of it, or for panning empty canvas. Re-selecting it once
  // deselected is a deliberate Header-level action (see SeatingChartApp's
  // "Edit Background" control), the same pattern the venue space uses.
  const isInteractive = isSelected;
  const isDraggable = editMode && !isLocked && isInteractive;

  const handleSelect = () => {
    if (!editMode) return;
    setSelectedShapeId(shape.id);
  };

  const handleDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    if (e.evt.altKey) {
      e.target.getStage()?.stopDrag();
    }
    e.evt.cancelBubble = true;
  };

  // Invisible-grid snapping — see lib/gridSnap.
  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    node.x(snapToGrid(node.x()));
    node.y(snapToGrid(node.y()));
  };

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    if (isLocked) return;
    setShape((prev) => ({
      ...prev,
      x: snapToGrid(e.target.x()),
      y: snapToGrid(e.target.y()),
    }));
  };

  const handleTransformEnd = () => {
    if (!editMode || isLocked) return;
    const node = shapeRef.current;
    if (!node) return;
    // keepRatio on the Transformer below guarantees scaleX === scaleY.
    const newScale = node.scaleX();
    const rotation = ((node.rotation() % 360) + 360) % 360;
    node.scaleX(1);
    node.scaleY(1);
    setShape((prev) => ({ ...prev, x: node.x(), y: node.y(), scale: newScale, rotation }));
  };

  if (!htmlImage) return null;

  return (
    <React.Fragment>
      <KonvaImage
        ref={shapeRef}
        id={shape.id}
        image={htmlImage}
        x={shape.x}
        y={shape.y}
        width={shape.naturalWidth}
        height={shape.naturalHeight}
        scaleX={shape.scale}
        scaleY={shape.scale}
        rotation={shape.rotation ?? 0}
        opacity={shape.opacity}
        draggable={isDraggable}
        listening={isInteractive}
        onClick={handleSelect}
        onTap={handleSelect}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onTransformEnd={handleTransformEnd}
        perfectDrawEnabled={false}
      />
      {isSelected && editMode && !isLocked && (
        <Transformer
          ref={trRef}
          rotateEnabled
          keepRatio
          enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]}
          boundBoxFunc={(oldBox, newBox) => {
            const minSize = Math.min(shape.naturalWidth, shape.naturalHeight) * MIN_SCALE;
            const maxSize = Math.max(shape.naturalWidth, shape.naturalHeight) * MAX_SCALE;
            if (newBox.width < minSize || newBox.height < minSize) return oldBox;
            if (newBox.width > maxSize || newBox.height > maxSize) return oldBox;
            return newBox;
          }}
          anchorCornerRadius={5}
        />
      )}
    </React.Fragment>
  );
};

// Wrapper component that performs the type check before rendering content
// — mirrors ElementRect/TableCircle's own wrapper pattern.
export const BackgroundImageShape: React.FC<BackgroundImageShapeProps> = ({
  shapeAtom,
}) => {
  const shapeValue = useAtomValue(shapeAtom);

  if (shapeValue.type !== "backgroundImage") {
    return null;
  }

  return (
    <BackgroundImageShapeContent
      shapeAtom={shapeAtom as PrimitiveAtom<BackgroundImage>}
    />
  );
};
