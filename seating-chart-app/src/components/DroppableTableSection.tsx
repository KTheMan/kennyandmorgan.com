import React, { useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Guest } from "../types/seatingChart";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { DraggableGuestListItem } from "./DraggableGuestListItem";
import { DraggableGroupHeader } from "./DraggableGroupHeader";
import { Users, Coffee, PlusCircle, Lock, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";

type GuestListEntry =
  | { kind: "header"; key: string; groupId: string; label: string; guests: Guest[] }
  | { kind: "guest"; key: string; guest: Guest };

// Clusters contiguous guests sharing a groupId (party) under a small,
// draggable header, e.g. "Jane Doe's Party (4)" — only meaningful for
// Unassigned, where guests aren't already ordered by physical seat.
// Assumes the caller has already sorted `guests` so same-party guests are
// adjacent (see Sidebar's groupedGuests sort).
function buildGuestListEntries(guests: Guest[]): GuestListEntry[] {
  const entries: GuestListEntry[] = [];
  let i = 0;
  while (i < guests.length) {
    const guest = guests[i];
    if (guest.groupId) {
      let j = i;
      const run: Guest[] = [];
      while (j < guests.length && guests[j].groupId === guest.groupId) {
        run.push(guests[j]);
        j += 1;
      }
      if (run.length > 1) {
        const primary = run.find((g) => g.isPrimary) ?? run[0];
        entries.push({
          kind: "header",
          key: `party-${guest.groupId}`,
          groupId: guest.groupId,
          label: `${primary.fullName}'s Party (${run.length})`,
          guests: run,
        });
      }
      run.forEach((g) => entries.push({ kind: "guest", key: g.id, guest: g }));
      i = j;
    } else {
      entries.push({ kind: "guest", key: guest.id, guest });
      i += 1;
    }
  }
  return entries;
}

interface GroupData {
  // Define locally or import if exported from Sidebar
  tableNumber: number | null;
  tableCapacity?: number;
  seatingLocked?: boolean;
  guests: Guest[];
}

interface DroppableTableSectionProps {
  tableId: string;
  groupData: GroupData;
  isUnassigned: boolean;
  newGuestName: string; // For the input field
  onNewGuestNameChange: (tableId: string, value: string) => void;
  onNewGuestSubmit: (
    event: React.KeyboardEvent<HTMLInputElement>,
    tableId: string,
  ) => void;
  onTableMouseEnter: (tableId: string) => void;
  onTableMouseLeave: () => void;
  onGuestMouseEnter: (guestId: string) => void;
  onGuestMouseLeave: () => void;
  onGuestRemove: (guestId: string) => void;
  isFlashingError: boolean;
  isInputVisible?: boolean;
  onToggleInput?: () => void;
  // Whether this table's seat assignments are frozen (see
  // Table.seatingLocked). Undefined/omitted for the Unassigned section,
  // which can't be locked.
  isSeatingLocked?: boolean;
  onToggleSeatingLock?: () => void;
}

export const DroppableTableSection: React.FC<DroppableTableSectionProps> = ({
  tableId,
  groupData,
  isUnassigned,
  newGuestName,
  onNewGuestNameChange,
  onNewGuestSubmit,
  onTableMouseEnter,
  onTableMouseLeave,
  onGuestMouseEnter,
  onGuestMouseLeave,
  onGuestRemove,
  isFlashingError,
  isInputVisible,
  onToggleInput,
  isSeatingLocked = false,
  onToggleSeatingLock,
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: tableId,
    disabled: isSeatingLocked,
  });
  const totalSeats = groupData.tableCapacity || 0;
  const occupiedSeats = groupData.guests.length;

  // Only cluster by party in Unassigned — once seated, guest order
  // reflects actual chair position and shouldn't be reshuffled by party.
  const listEntries = useMemo(
    () => (isUnassigned ? buildGuestListEntries(groupData.guests) : groupData.guests.map((guest) => ({ kind: "guest" as const, key: guest.id, guest }))),
    [groupData.guests, isUnassigned],
  );

  const outlineClass = isFlashingError
    ? "outline outline-2 outline-destructive outline-offset-2 ring-destructive"
    : isOver
      ? "outline outline-2 outline-primary outline-offset-2"
      : "";

  return (
    <div
      ref={setNodeRef}
      className={`w-full min-w-0 max-w-full overflow-hidden rounded-lg px-4 py-3.5 shadow-sm transition-all ${
        isUnassigned
          ? "bg-sidebar-accent/5 border border-sidebar-border/30"
          : "bg-sidebar-accent/10"
      } ${outlineClass}`}
      onMouseEnter={() => onTableMouseEnter(tableId)}
      onMouseLeave={onTableMouseLeave}
    >
      {/* Header */}
      <div className="mb-2.5 flex min-w-0 items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center font-medium text-sidebar-primary">
          {groupData.tableNumber !== null ? (
            <>
              <span className="inline-flex items-center justify-center bg-sidebar-primary/10 text-sidebar-primary w-7 h-7 rounded-full mr-2 text-sm shadow-sm">
                {groupData.tableNumber}
              </span>
              <span className="truncate">Table {groupData.tableNumber}</span>
            </>
          ) : (
            <span className="flex min-w-0 items-center text-sidebar-foreground/80">
              <Coffee size={16} className="mr-1.5 shrink-0" strokeWidth={1.5} />
              <span className="truncate">Unassigned Guests</span>
            </span>
          )}
        </h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {isUnassigned ? (
            <Badge
              variant="outline"
              className="text-xs bg-sidebar-accent/10 text-sidebar-foreground/80 shadow-sm border-sidebar-border/40"
            >
              {occupiedSeats}
            </Badge>
          ) : (
            <>
              <Badge
                variant="outline"
                className="text-xs bg-sidebar-accent/10 text-sidebar-foreground/80 shadow-sm border-sidebar-border/40 px-2"
              >
                <Users size={12} className="mr-1.5" strokeWidth={1.5} />
                {occupiedSeats}/{totalSeats}
              </Badge>
              {/* Seating lock — freezes this table's guest assignments
                  (add/remove/rearrange, both here and by dragging seat
                  nodes on the canvas). Independent of the table's own
                  position lock on the canvas. */}
              {onToggleSeatingLock && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={`h-6 w-6 shrink-0 rounded-full ${
                    isSeatingLocked
                      ? "text-destructive hover:text-destructive hover:bg-destructive/10"
                      : "text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/20"
                  }`}
                  onClick={onToggleSeatingLock}
                  aria-label={
                    isSeatingLocked
                      ? "Unlock this table's seating"
                      : "Lock this table's seating"
                  }
                  title={
                    isSeatingLocked
                      ? "Seating locked — click to unlock"
                      : "Lock seating arrangement"
                  }
                >
                  {isSeatingLocked ? (
                    <Lock size={14} strokeWidth={1.75} />
                  ) : (
                    <Unlock size={14} strokeWidth={1.75} />
                  )}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      <Separator className="mb-3 bg-sidebar-accent/20" />

      {/* Guest List */}
      <ul className="min-w-0 space-y-1">
        {listEntries.map((entry) =>
          entry.kind === "header" ? (
            <DraggableGroupHeader
              key={entry.key}
              groupId={entry.groupId}
              guests={entry.guests}
              label={entry.label}
            />
          ) : (
            <DraggableGuestListItem
              key={entry.key}
              guest={entry.guest}
              onMouseEnter={onGuestMouseEnter}
              onMouseLeave={onGuestMouseLeave}
              onRemove={onGuestRemove}
              disabled={isSeatingLocked}
            />
          ),
        )}
      </ul>

      {/* Add Guest Input / Button */}
      {isUnassigned ? (
        <div className="mt-3 min-w-0 text-center">
          {isInputVisible ? (
            <Input
              type="text"
              placeholder="Add Unassigned Guest..."
              className="h-8 text-sm bg-sidebar-accent/20 border-sidebar-border/30 focus:border-primary/50 focus:bg-sidebar-accent/40 placeholder:text-sidebar-foreground/50"
              value={newGuestName || ""}
              onChange={(e) => onNewGuestNameChange(tableId, e.target.value)}
              onKeyDown={(e) => onNewGuestSubmit(e, tableId)}
              autoFocus
            />
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-sidebar-foreground/80 border-sidebar-border/50 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground"
              onClick={onToggleInput}
            >
              <PlusCircle size={16} className="mr-2" />
              Add Unassigned Guest
            </Button>
          )}
        </div>
      ) : (
        !isSeatingLocked && occupiedSeats < totalSeats && (
          <div className="relative mt-2 min-w-0 pl-3 pr-1">
            <Input
              type="text"
              placeholder="Add Guest..."
              className="h-8 text-sm bg-sidebar-accent/20 border-sidebar-border/30 focus:border-primary/50 focus:bg-sidebar-accent/40 placeholder:text-sidebar-foreground/50 pr-2"
              value={newGuestName || ""}
              onChange={(e) => onNewGuestNameChange(tableId, e.target.value)}
              onKeyDown={(e) => onNewGuestSubmit(e, tableId)}
            />
          </div>
        )
      )}
    </div>
  );
};
