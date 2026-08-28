import React, { useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
// import { CSS } from '@dnd-kit/utilities'; // Not strictly needed for basic translate3d
import { Guest } from "../types/seatingChart";
import { Button } from "@/components/ui/button";
import { GripVertical, Lock, MoreVertical, Trash2, UserCircle } from "lucide-react";
import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import { editModeAtom, hoveredGuestIdAtom } from "@/lib/atoms";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  const foodChoice = guest.mealChoice?.trim();
  const dietaryNotes = guest.dietaryNotes?.trim();

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
          className="mr-1 flex h-6 w-6 shrink-0 touch-none cursor-grab items-center justify-center rounded text-sidebar-foreground/35 transition-colors hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary/50 active:cursor-grabbing [@media(hover:none)]:h-9 [@media(hover:none)]:w-9"
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
        className={`shrink-0 self-start mt-0.5 transition-colors duration-200 ${
          isHighlighted
            ? "text-sidebar-primary"
            : "text-sidebar-foreground/70 group-hover:text-sidebar-primary"
        }`}
        strokeWidth={1.5}
      />
      <div className="ml-2 min-w-0 flex-1">
        <div className="flex min-w-0 items-start gap-2">
          <span
            className={`min-w-0 flex-1 truncate font-medium ${
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
            <span className="shrink-0 rounded-full bg-sidebar-accent/20 px-2 py-0.5 text-xs text-sidebar-foreground/70">
              Seat {guest.chairIndex + 1}
            </span>
          )}
        </div>
        {(foodChoice || dietaryNotes) && (
          <dl className="mt-1 space-y-0.5 text-xs leading-snug text-sidebar-foreground/65">
            {foodChoice && (
              <div className="flex min-w-0 gap-1.5">
                <dt className="shrink-0 font-medium text-sidebar-foreground/80">Food:</dt>
                <dd className="min-w-0 break-words">{foodChoice}</dd>
              </div>
            )}
            {dietaryNotes && (
              <div className="flex min-w-0 gap-1.5">
                <dt className="shrink-0 font-medium text-sidebar-foreground/80">Dietary notes:</dt>
                <dd className="min-w-0 break-words">{dietaryNotes}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
      {!disabled && editMode && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="ml-1 h-6 w-6 shrink-0 touch-manipulation rounded-full p-0.5 text-sidebar-foreground/50 opacity-0 transition-[color,background-color,opacity] duration-150 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:bg-sidebar-accent/30 data-[state=open]:text-sidebar-foreground data-[state=open]:opacity-100 [@media(hover:none)]:h-9 [@media(hover:none)]:w-9 [@media(hover:none)]:opacity-100"
              onPointerDown={(event) => event.stopPropagation()}
              aria-label={`Actions for ${guest.fullName}`}
              title={`Actions for ${guest.fullName}`}
            >
              <MoreVertical size={15} strokeWidth={2} aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={4} collisionPadding={8}>
            <DropdownMenuItem
              className="cursor-pointer gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
              onSelect={(event) => {
                event.stopPropagation();
                onRemove(guest.id);
              }}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Remove guest
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
};
