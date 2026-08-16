import React, { useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
// import { CSS } from '@dnd-kit/utilities'; // Not strictly needed for basic translate3d
import { Guest } from "../types/seatingChart";
import { Button } from "@/components/ui/button";
import { GripVertical, UserCircle, X, Lock } from "lucide-react";
import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import { editModeAtom, hoveredGuestIdAtom } from "@/lib/atoms";

interface DraggableGuestListItemProps {
  guest: Guest;
  onRemove: (guestId: string) => void;
  onMouseEnter: (guestId: string) => void;
  onMouseLeave: () => void;
  // True when this guest's table has its seating locked (see
  // Table.seatingLocked) — blocks both dragging this guest elsewhere and
  // removing them.
  disabled?: boolean;
}

export const DraggableGuestListItem: React.FC<DraggableGuestListItemProps> = ({
  guest,
  onRemove,
  onMouseEnter,
  onMouseLeave,
  disabled = false,
}) => {
  const editMode = useAtomValue(editModeAtom);
  const isHighlightedAtom = useMemo(
    () => selectAtom(hoveredGuestIdAtom, (hoveredId) => hoveredId === guest.id),
    [guest.id],
  );
  const isHighlighted = useAtomValue(isHighlightedAtom);
  const canDrag = editMode && !disabled;

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: guest.id,
    data: { kind: "guest" as const, guest },
    disabled: !canDrag,
  });

  return (
    <li
      ref={setNodeRef}
      className={`group relative flex min-w-0 max-w-full items-center overflow-hidden rounded-md border px-2 py-2 text-sm ring-1 transition-colors duration-150 ${disabled ? "cursor-not-allowed" : "cursor-default"} ${
        isHighlighted
          ? "bg-sidebar-accent/40 shadow-sm border-sidebar-primary/30 ring-sidebar-primary/20"
          : "border-transparent ring-transparent hover:bg-sidebar-accent/20"
      } ${isDragging ? "bg-sidebar-accent/30 opacity-45 ring-sidebar-primary/30" : ""}`}
      onMouseEnter={() => onMouseEnter(guest.id)}
      onMouseLeave={onMouseLeave}
    >
      {disabled ? (
        <Lock
          size={13}
          strokeWidth={1.75}
          className="mr-1 h-6 w-6 shrink-0 p-1 text-sidebar-foreground/30"
          aria-hidden="true"
        />
      ) : canDrag ? (
        <button
          type="button"
          className="mr-1 flex h-6 w-6 shrink-0 touch-none cursor-grab items-center justify-center rounded text-sidebar-foreground/35 transition-colors hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary/50 active:cursor-grabbing"
          aria-label={`Drag ${guest.fullName}`}
          title={`Drag ${guest.fullName}`}
          {...listeners}
          {...attributes}
        >
          <GripVertical size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ) : (
        <span className="mr-1 h-6 w-6 shrink-0" aria-hidden="true" />
      )}
      <UserCircle
        size={18}
        className={`transition-colors duration-200 ${
          isHighlighted
            ? "text-sidebar-primary"
            : "text-sidebar-foreground/70 group-hover:text-sidebar-primary"
        }`}
        strokeWidth={1.5}
      />
      <span
        className={`ml-2 min-w-0 flex-1 truncate font-medium ${
          isHighlighted ? "text-sidebar-primary" : "text-sidebar-foreground"
        }`}
        title={guest.fullName}
      >
        {guest.fullName}
        {guest.isChild && (
          <span className="ml-1.5 text-xs font-normal text-sidebar-foreground/50">(child)</span>
        )}
      </span>
      {guest.tableId && typeof guest.chairIndex === "number" && (
        <span className="ml-2 shrink-0 rounded-full bg-sidebar-accent/20 px-2 py-0.5 text-xs text-sidebar-foreground/70">
          Seat {guest.chairIndex + 1}
        </span>
      )}
      {!disabled && editMode && (
        <Button
          variant="ghost"
          size="icon"
          className="ml-1 h-6 w-6 shrink-0 rounded-full p-0.5 text-sidebar-foreground/50 opacity-0 transition-opacity duration-150 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(guest.id);
          }}
          aria-label={`Remove ${guest.fullName}`}
        >
          <X size={14} strokeWidth={2} />
        </Button>
      )}
    </li>
  );
};
