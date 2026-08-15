import React from "react";
import { useDraggable } from "@dnd-kit/core";
import { Guest } from "../types/seatingChart";
import { UsersRound } from "lucide-react";
import { useAtomValue } from "jotai";
import { editModeAtom } from "@/lib/atoms";

interface DraggableGroupHeaderProps {
  groupId: string;
  guests: Guest[];
  label: string;
}

// Drags the whole party at once so it can be seated together in one
// motion — a one-time convenience for initial placement only. Once
// dropped, every guest in the party gets an ordinary tableId/chairIndex
// exactly like a guest seated one at a time; nothing here creates a
// lasting link between them, so they're each freely movable afterward.
export const DraggableGroupHeader: React.FC<DraggableGroupHeaderProps> = ({
  groupId,
  guests,
  label,
}) => {
  const editMode = useAtomValue(editModeAtom);
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `group-${groupId}`,
      data: { kind: "group" as const, guests, groupLabel: label },
      disabled: !editMode,
    });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: isDragging ? 50 : "auto",
      }
    : undefined;

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...(editMode ? listeners : {})}
      {...(editMode ? attributes : {})}
      className={`flex items-center gap-1.5 pt-2 pb-0.5 px-1 -mx-1 text-xs font-medium uppercase tracking-wide text-sidebar-foreground/50 rounded-md transition-all ${
        editMode
          ? "cursor-grab hover:bg-sidebar-accent/20 hover:text-sidebar-foreground/80"
          : ""
      } ${isDragging ? "opacity-50" : ""}`}
      title={
        editMode
          ? "Drag to seat the whole party together"
          : undefined
      }
    >
      <UsersRound size={12} strokeWidth={1.5} />
      {label}
    </li>
  );
};
