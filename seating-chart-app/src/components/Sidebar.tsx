import React, {
  useMemo,
  useCallback,
  useEffect,
  useState,
  useRef,
} from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import {
  hoveredGuestIdAtom,
  isDraggingAtom,
  hoveredTableIdAtom,
  guestsAtom,
  editModeAtom,
  baseShapesAtom,
} from "@/lib/atoms";
import { Guest, Table } from "../types/seatingChart";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Users,
  Coffee,
  User2,
  Info,
  Table2 as TableIcon,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { DroppableTableSection } from "./DroppableTableSection";
import { ScrollIndicator } from "./ScrollIndicator";
import { fetchAcceptedGuestParties } from "@/lib/api/guestConnector";
import { tryVerifyAdminSession } from "@/lib/adminAuth";

interface SidebarProps {
  guests: Guest[];
  tables: Table[];
  isAdmin: boolean;
  isInSheet?: boolean;
  // Drag-and-drop now spans both the sidebar and the canvas (a guest can
  // be dropped directly onto a specific chair), so the DndContext/drag
  // state lives in SeatingChartApp — this is just the one piece Sidebar
  // still needs to render the "table is full" flash.
  flashErrorTableId: string | null;
}

export const Sidebar: React.FC<SidebarProps> = ({
  guests,
  tables,
  isAdmin,
  isInSheet,
  flashErrorTableId,
}) => {
  const store = useStore();
  const setHoveredGuestId = useSetAtom(hoveredGuestIdAtom);
  const setHoveredTableId = useSetAtom(hoveredTableIdAtom);
  const setGlobalGuests = useSetAtom(guestsAtom);
  const setBaseShapes = useSetAtom(baseShapesAtom);
  const editMode = useAtomValue(editModeAtom);
  const [newGuestNames, setNewGuestNames] = useState<Record<string, string>>(
    {},
  );
  const [isSyncingGuests, setIsSyncingGuests] = useState(false);
  const { toast } = useToast();
  const [showUnassignedInput, setShowUnassignedInput] = useState(false);

  const scrollAreaRootRef = useRef<HTMLDivElement>(null);
  const scrollContentWrapperRef = useRef<HTMLDivElement>(null);
  const [showScrollIndicator, setShowScrollIndicator] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleGuestMouseEnter = (guestId: string) => {
    if (store.get(isDraggingAtom)) return;
    setHoveredGuestId(guestId);
  };

  const handleGuestMouseLeave = () => {
    setHoveredGuestId(null);
  };

  const handleTableMouseEnter = (tableId: string) => {
    if (store.get(isDraggingAtom) || tableId === "unassigned") return;
    setHoveredTableId(tableId);
  };

  const handleTableMouseLeave = () => {
    setHoveredTableId(null);
  };

  const tableMap = useMemo(() => {
    const map = new Map<string, Table>();
    tables.forEach((table) => map.set(table.id, table));
    return map;
  }, [tables]);

  const groupedGuests = useMemo(() => {
    const groups: Record<
      string,
      {
        tableNumber: number | null;
        tableCapacity?: number;
        seatingLocked?: boolean;
        guests: Guest[];
      }
    > = {
      unassigned: { tableNumber: null, guests: [] },
    };
    const unassignedGuestsFromLoop: Guest[] = [];

    tables.forEach((table) => {
      groups[table.id] = {
        tableNumber: table.number,
        tableCapacity: table.capacity,
        seatingLocked: table.seatingLocked === true,
        guests: [],
      };
    });

    guests.forEach((guest) => {
      const guestTableId = guest.tableId || "unassigned";

      if (guestTableId !== "unassigned" && tableMap.has(guestTableId)) {
        if (!groups[guestTableId]) {
          groups[guestTableId] = {
            tableNumber: tableMap.get(guestTableId)?.number ?? null,
            tableCapacity: tableMap.get(guestTableId)?.capacity,
            seatingLocked: tableMap.get(guestTableId)?.seatingLocked === true,
            guests: [],
          };
        }
        groups[guestTableId].guests.push(guest);
      } else {
        groups["unassigned"].guests.push(guest);
      }
    });

    Object.values(groups).forEach((group) => {
      if (group.tableNumber !== null) {
        group.guests.sort((a, b) => (a.chairIndex ?? 0) - (b.chairIndex ?? 0));
      } else {
        // Cluster unassigned guests by party (groupId) so a family/table
        // group stays visually together instead of scattering
        // alphabetically; ungrouped (manually-added) guests sort after,
        // by name.
        group.guests.sort((a, b) => {
          const groupA = (a.groupId || "").toLowerCase();
          const groupB = (b.groupId || "").toLowerCase();
          if (groupA !== groupB) {
            if (!groupA) return 1;
            if (!groupB) return -1;
            return groupA.localeCompare(groupB);
          }
          if (Boolean(a.isPrimary) !== Boolean(b.isPrimary)) {
            return a.isPrimary ? -1 : 1;
          }
          return (a.fullName || "").toLowerCase().localeCompare((b.fullName || "").toLowerCase());
        });
      }
    });

    const sortedGroupKeys = Object.keys(groups).sort((a, b) => {
      if (a === "unassigned") return -1;
      if (b === "unassigned") return 1;
      const numA = groups[a].tableNumber ?? Infinity;
      const numB = groups[b].tableNumber ?? Infinity;
      return numA - numB;
    });

    const sortedGroups: Record<
      string,
      {
        tableNumber: number | null;
        tableCapacity?: number;
        seatingLocked?: boolean;
        guests: Guest[];
      }
    > = {};
    sortedGroupKeys.forEach((key) => {
      sortedGroups[key] = groups[key];
    });
    return sortedGroups;
  }, [guests, tables, tableMap]);

  const totalGuestCount = guests.length;
  const assignedGuestCount = guests.filter((g) => g.tableId).length;

  const findNextAvailableSeat = (
    currentGuests: Guest[],
    capacity: number,
  ): number | null => {
    if (currentGuests.length >= capacity) return null;
    const occupiedSeats = new Set<number>();
    currentGuests.forEach((guest) => {
      if (typeof guest.chairIndex === "number")
        occupiedSeats.add(guest.chairIndex);
    });
    for (let i = 0; i < capacity; i++) {
      if (!occupiedSeats.has(i)) return i;
    }
    return null;
  };

  const handleAddGuestKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    tableId: string,
  ) => {
    if (!editMode) {
        toast({ title: "View-Only Mode", description: "Cannot add guests while in view-only mode.", variant: "destructive" });
        return;
    }
    const group = groupedGuests[tableId];
    if (!group) return;
    if (group.seatingLocked) {
      toast({
        title: "Seating Locked",
        description: "Unlock this table's seating to add guests.",
        variant: "destructive",
      });
      return;
    }
    const capacity =
      tableId === "unassigned" ? Infinity : group.tableCapacity || 0;
    const currentTableGuests = group.guests;

    if (event.key === "Enter") {
      event.preventDefault();
      const name = (newGuestNames[tableId] || "").trim();
      if (!name) return;

      let nextSeatIndex: number | null = null;
      if (tableId !== "unassigned") {
        nextSeatIndex = findNextAvailableSeat(currentTableGuests, capacity);
        if (nextSeatIndex === null) {
          console.error("Attempted to add guest to a full table:", tableId);
          return;
        }
      }

      const newGuest: Guest = {
        id: `guest-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        fullName: name,
        tableId: tableId === "unassigned" ? "" : tableId,
        chairIndex: nextSeatIndex,
      };
      setGlobalGuests((prev) => [...prev, newGuest]);
      setNewGuestNames((prev) => ({ ...prev, [tableId]: "" }));
    }
  };

  // Drag-and-drop (both onto a sidebar table section, and directly onto a
  // specific chair on the canvas) is handled by SeatingChartApp now, which
  // owns the shared DndContext spanning both regions.

  const handleRemoveGuest = (guestIdToRemove: string) => {
    if (!editMode) {
        toast({ title: "View-Only Mode", description: "Cannot remove guests while in view-only mode.", variant: "destructive" });
        return;
    }
    const guest = guests.find((g) => g.id === guestIdToRemove);
    const guestTable = guest?.tableId ? tableMap.get(guest.tableId) : undefined;
    if (guestTable?.seatingLocked) {
      toast({
        title: "Seating Locked",
        description: `Table ${guestTable.number}'s seating is locked. Unlock it to remove guests.`,
        variant: "destructive",
      });
      return;
    }
    setGlobalGuests((prevGuests) =>
      prevGuests.filter((guest) => guest.id !== guestIdToRemove),
    );
  };

  // Toggles whether a table's seat assignments are frozen (see
  // Table.seatingLocked) — the sidebar-only counterpart to a table's own
  // position lock on the canvas.
  const handleToggleSeatingLock = (tableId: string) => {
    if (!editMode) return;
    setBaseShapes((prev) =>
      prev.map((s) =>
        s.type === "table" && s.id === tableId
          ? { ...s, seatingLocked: !s.seatingLocked }
          : s,
      ),
    );
  };

  // The connector: pulls "accepted" RSVPs and their parties from the
  // wedding site and drops any not already on the canvas into
  // "Unassigned". Guests already imported (matched by weddingGuestId) are
  // left untouched so re-syncing never disturbs seating you've already done.
  // Admin-only — re-verified here rather than trusting a passed-down
  // token, since this is the one action that reaches into the real
  // guest/RSVP list rather than just this chart's own data.
  const handleSyncAcceptedGuests = async () => {
    setIsSyncingGuests(true);
    try {
      const adminSession = await tryVerifyAdminSession();
      if (!adminSession) {
        toast({
          title: "Admin Sign-In Required",
          description: "Sync is only available to the site admin.",
          variant: "destructive",
        });
        return;
      }
      const parties = await fetchAcceptedGuestParties(adminSession.token);
      const existingIds = new Set(
        guests.map((g) => g.weddingGuestId).filter(Boolean),
      );

      const newGuests: Guest[] = [];
      for (const party of parties) {
        for (const acceptedGuest of party.guests) {
          if (existingIds.has(acceptedGuest.weddingGuestId)) continue;

          newGuests.push({
            id: `wg-${acceptedGuest.weddingGuestId}`,
            fullName: acceptedGuest.fullName,
            tableId: "",
            chairIndex: null,
            weddingGuestId: acceptedGuest.weddingGuestId,
            groupId: party.groupId,
            isPrimary: acceptedGuest.isPrimary,
            isPlusOne: acceptedGuest.isPlusOne,
            isChild: acceptedGuest.isChild,
            mealChoice: acceptedGuest.mealChoice,
            dietaryNotes: acceptedGuest.dietaryNotes,
          });
        }
      }

      if (newGuests.length > 0) {
        setGlobalGuests((prev) => [...prev, ...newGuests]);
      }

      const totalAccepted = parties.reduce((sum, p) => sum + p.guests.length, 0);
      toast({
        title: "Guest List Synced",
        description: newGuests.length > 0
          ? `Added ${newGuests.length} new guest${newGuests.length === 1 ? "" : "s"} to Unassigned.`
          : `Already up to date — ${totalAccepted} accepted guest${totalAccepted === 1 ? "" : "s"} on the canvas.`,
      });
    } catch (error: unknown) {
      toast({
        title: "Sync Failed",
        description: error instanceof Error ? error.message : "Could not load accepted guests.",
        variant: "destructive",
      });
    } finally {
      setIsSyncingGuests(false);
    }
  };

  useEffect(() => {
    const root = scrollAreaRootRef.current;
    const container = root?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    const content = scrollContentWrapperRef.current;

    if (!container || !content) {
      return;
    }

    const handleScrollOrResize = () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      setIsScrolling(true);

      // This sidebar only scrolls vertically. Keeping scrollLeft pinned
      // prevents a drag gesture from shifting the entire list offscreen.
      if (container.scrollLeft !== 0) container.scrollLeft = 0;

      const isScrollable = container.scrollHeight > container.clientHeight + 1;
      if (isScrollable) {
        const isAtBottom =
          container.scrollTop + container.clientHeight >=
          container.scrollHeight - 5;
        setShowScrollIndicator(!isAtBottom);
      } else {
        setShowScrollIndicator(false);
      }

      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 150);
    };

    handleScrollOrResize();

    container.addEventListener("scroll", handleScrollOrResize);

    const resizeObserver = new ResizeObserver(handleScrollOrResize);
    resizeObserver.observe(container);
    resizeObserver.observe(content);

    return () => {
      container.removeEventListener("scroll", handleScrollOrResize);
      resizeObserver.disconnect();
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [groupedGuests]);

  const sidebarRootClasses = isInSheet
    ? "bg-sidebar flex min-w-0 flex-col h-full overflow-hidden"
    : "relative shrink-0 bg-sidebar flex min-w-0 flex-col h-full border-r border-sidebar-border/70 overflow-hidden lg:w-[22rem] 2xl:w-96";

  return (
    <div className={sidebarRootClasses} data-seating-sidebar>
      <div className="absolute inset-0 texture-elegant opacity-90 pointer-events-none"></div>
      <div
        className={`relative z-10 border-b border-sidebar-border/50 bg-sidebar-accent/5 p-4 shadow-sm ${isInSheet ? "pr-12" : ""}`}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-medium text-sidebar-foreground">
            Guest List
          </h2>
          <Badge
            variant="outline"
            className="bg-sidebar-accent/10 text-sidebar-foreground shadow-sm border-sidebar-border/40 px-2.5 py-1"
          >
            <TableIcon size={14} className="mr-1.5" strokeWidth={1.5} />
            {tables.length} Table{tables.length === 1 ? "" : "s"}
          </Badge>
        </div>
        {isAdmin && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSyncAcceptedGuests}
            disabled={isSyncingGuests}
            className="mt-3 w-full justify-center border-sidebar-border/40 bg-sidebar-accent/5 hover:bg-sidebar-accent/15 text-sidebar-foreground font-medium shadow-sm"
          >
            <RefreshCw
              size={14}
              className={`mr-2 ${isSyncingGuests ? "animate-spin" : ""}`}
              strokeWidth={1.5}
            />
            {isSyncingGuests ? "Syncing…" : "Sync Accepted Guests"}
          </Button>
        )}
      </div>

      {Object.keys(groupedGuests).length === 0 ? (
        <div className="relative z-10 flex-1 flex items-center justify-center text-sidebar-foreground/70 text-center px-4">
          <div className="bg-sidebar-accent/5 rounded-lg p-7 border border-sidebar-border/30 max-w-60 shadow-sm">
            <User2
              size={36}
              className="mx-auto mb-4 text-sidebar-primary/60"
              strokeWidth={1.5}
            />
            <p className="font-medium text-sidebar-foreground mb-2">
              No guests assigned yet
            </p>
            <p className="text-sm leading-relaxed">
              Click chairs on tables to assign guests to your seating chart
            </p>
          </div>
        </div>
      ) : (
        <ScrollArea
          ref={scrollAreaRootRef}
          className="relative z-10 min-w-0 flex-1 overflow-x-hidden"
        >
          <div
            ref={scrollContentWrapperRef}
            className="w-full min-w-0 max-w-full space-y-3 p-4"
          >
            {Object.entries(groupedGuests).map(([tableId, groupData]) => {
              const isUnassigned = groupData.tableNumber === null;
              return (
                <DroppableTableSection
                  key={tableId}
                  tableId={tableId}
                  groupData={groupData}
                  isUnassigned={isUnassigned}
                  newGuestName={newGuestNames[tableId] || ""}
                  onNewGuestNameChange={(id, value) =>
                    setNewGuestNames((prev) => ({ ...prev, [id]: value }))
                  }
                  onNewGuestSubmit={(e, id) => handleAddGuestKeyDown(e, id)}
                  onTableMouseEnter={handleTableMouseEnter}
                  onTableMouseLeave={handleTableMouseLeave}
                  onGuestMouseEnter={handleGuestMouseEnter}
                  onGuestMouseLeave={handleGuestMouseLeave}
                  onGuestRemove={handleRemoveGuest}
                  isFlashingError={tableId === flashErrorTableId}
                  isInputVisible={
                    isUnassigned ? showUnassignedInput : undefined
                  }
                  onToggleInput={
                    isUnassigned
                      ? () => setShowUnassignedInput((prev) => !prev)
                      : undefined
                  }
                  isSeatingLocked={groupData.seatingLocked}
                  onToggleSeatingLock={
                    isUnassigned
                      ? undefined
                      : () => handleToggleSeatingLock(tableId)
                  }
                />
              );
            })}
          </div>
        </ScrollArea>
      )}
      <ScrollIndicator isVisible={showScrollIndicator && !isScrolling} />
    </div>
  );
};
