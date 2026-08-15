import React from "react";
import { useDraggable } from "@dnd-kit/core";
// import { CSS } from '@dnd-kit/utilities'; // Not strictly needed for basic translate3d
import { Guest } from "../types/seatingChart";
import { Button } from "@/components/ui/button";
import { UserCircle, X, Lock } from "lucide-react";
import { useAtomValue } from "jotai";
import { editModeAtom } from "@/lib/atoms";

interface DraggableGuestListItemProps {
  guest: Guest;
  isHighlighted: boolean;
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
  isHighlighted,
  onRemove,
  onMouseEnter,
  onMouseLeave,
  disabled = false,
}) => {
  const editMode = useAtomValue(editModeAtom);
  const canDrag = editMode && !disabled;

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: guest.id,
      data: { kind: "guest" as const, guest },
      disabled: !canDrag,
    });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        // Add zIndex to ensure dragged item appears above others during transform
        zIndex: isDragging ? 50 : "auto",
      }
    : undefined;

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...(canDrag ? listeners : {})}
      {...(canDrag ? attributes : {})}
      className={`group flex items-center py-2.5 px-3 text-sm rounded-md ${canDrag ? 'cursor-grab' : disabled ? 'cursor-not-allowed' : 'cursor-default'} transition-all duration-300 border ring-1 relative ${
        isHighlighted
          ? "bg-sidebar-accent/40 shadow-sm border-sidebar-primary/30 ring-sidebar-primary/20"
          : "border-transparent ring-transparent hover:bg-sidebar-accent/20"
      } ${isDragging ? "opacity-50 shadow-lg" : ""}`} // Keep zIndex separate in style prop
      onMouseEnter={() => onMouseEnter(guest.id)}
      onMouseLeave={onMouseLeave}
    >
      {disabled ? (
        <Lock
          size={13}
          strokeWidth={1.75}
          className="h-5 w-5 mr-1 shrink-0 p-0.5 text-sidebar-foreground/30"
          aria-hidden="true"
        />
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 mr-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150 text-sidebar-foreground/50 hover:text-destructive hover:bg-destructive/10 rounded-full p-0.5"
          onClick={(e) => {
            if (!editMode) return;
            e.stopPropagation();
            onRemove(guest.id);
          }}
          aria-label="Remove guest"
          disabled={!editMode}
        >
          <X size={14} strokeWidth={2} />
        </Button>
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
        className={`font-medium flex-grow min-w-0 truncate ml-2 ${
          isHighlighted ? "text-sidebar-primary" : "text-sidebar-foreground"
        }`}
      >
        {guest.fullName}
        {guest.isChild && (
          <span className="ml-1.5 text-xs font-normal text-sidebar-foreground/50">(child)</span>
        )}
      </span>
      {guest.tableId && typeof guest.chairIndex === "number" && (
        <span className="ml-auto text-xs bg-sidebar-accent/20 px-2 py-0.5 rounded-full text-sidebar-foreground/70">
          Seat {guest.chairIndex + 1}
        </span>
      )}
    </li>
  );
};
