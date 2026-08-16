import React from "react";
import { useDraggable } from "@dnd-kit/core";
import { Guest } from "../types/seatingChart";
import { GripVertical, UsersRound } from "lucide-react";
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
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `group-${groupId}`,
    data: { kind: "group" as const, guests, groupLabel: label },
    disabled: !editMode,
  });

  return (
    <li
      ref={setNodeRef}
      className={`min-w-0 max-w-full pt-2 transition-opacity ${isDragging ? "opacity-45" : ""}`}
    >
      {editMode ? (
        <button
          type="button"
          className="flex w-full min-w-0 touch-none cursor-grab items-center gap-1.5 rounded-md px-1 py-1 text-left text-xs font-medium uppercase tracking-wide text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent/20 hover:text-sidebar-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary/50 active:cursor-grabbing"
          title={`Drag ${label} together`}
          aria-label={`Drag ${label} together`}
          {...listeners}
          {...attributes}
        >
          <GripVertical size={13} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
          <UsersRound size={12} strokeWidth={1.5} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{label}</span>
        </button>
      ) : (
        <div
          className="flex w-full min-w-0 items-center gap-1.5 px-1 py-1 text-xs font-medium uppercase tracking-wide text-sidebar-foreground/50"
          title={label}
        >
          <UsersRound size={12} strokeWidth={1.5} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{label}</span>
        </div>
      )}
    </li>
  );
};
