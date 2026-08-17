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
  Search,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { DroppableTableSection } from "./DroppableTableSection";
import { ScrollIndicator } from "./ScrollIndicator";
import { fetchAcceptedGuestParties } from "@/lib/api/guestConnector";
import { tryVerifyAdminSession } from "@/lib/adminAuth";
import { getMergedSeatingMembers } from "@/lib/tableLinks";

interface SidebarGuestGroup {
  tableNumber: number | null;
  tableLabel?: string;
  tableCapacity?: number;
  seatingLocked?: boolean;
  memberTableIds?: string[];
  guests: Guest[];
}

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
  onSelectTable?: (tableId: string) => void;
  onSelectGuest?: (guest: Guest) => void;
}

type SidebarFilter = "all" | "unassigned" | "open" | "locked";

const SIDEBAR_FILTERS: Array<{ id: SidebarFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "unassigned", label: "Unassigned" },
  { id: "open", label: "Open seats" },
  { id: "locked", label: "Locked" },
];

export const Sidebar: React.FC<SidebarProps> = ({
  guests,
  tables,
  isAdmin,
  isInSheet,
  flashErrorTableId,
  onSelectTable,
  onSelectGuest,
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
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<SidebarFilter>("all");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(
    {},
  );

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
    const groups: Record<string, SidebarGuestGroup> = {
      unassigned: { tableNumber: null, guests: [] },
    };
    const tableGroupKeys = new Map<string, string>();

    tables.forEach((table) => {
      const members = getMergedSeatingMembers(tables, table.id);
      const primary = members[0] ?? table;
      const groupKey = primary.id;
      members.forEach((member) => tableGroupKeys.set(member.id, groupKey));
      if (groups[groupKey]) return;
      groups[groupKey] = {
        tableNumber: primary.number,
        tableLabel:
          members.length > 1
            ? `Table ${primary.number} · linked with ${members
                .filter((member) => member.id !== primary.id)
                .map((member) => member.number)
                .join("+")}`
            : `Table ${primary.number}`,
        tableCapacity: members.reduce((sum, member) => sum + member.capacity, 0),
        seatingLocked: members.some((member) => member.seatingLocked === true),
        memberTableIds: members.map((member) => member.id),
        guests: [],
      };
    });

    guests.forEach((guest) => {
      const guestTableId = guest.tableId || "unassigned";

      if (guestTableId !== "unassigned" && tableMap.has(guestTableId)) {
        const groupKey = tableGroupKeys.get(guestTableId) ?? guestTableId;
        if (!groups[groupKey]) {
          groups[groupKey] = {
            tableNumber: tableMap.get(guestTableId)?.number ?? null,
            tableCapacity: tableMap.get(guestTableId)?.capacity,
            seatingLocked: tableMap.get(guestTableId)?.seatingLocked === true,
            memberTableIds: [guestTableId],
            guests: [],
          };
        }
        groups[groupKey].guests.push(guest);
      } else {
        groups["unassigned"].guests.push(guest);
      }
    });

    Object.values(groups).forEach((group) => {
      if (group.tableNumber !== null) {
        const memberOrder = new Map(
          (group.memberTableIds ?? []).map((tableId, index) => [tableId, index]),
        );
        group.guests.sort(
          (a, b) =>
            (memberOrder.get(a.tableId) ?? 0) - (memberOrder.get(b.tableId) ?? 0) ||
            (a.chairIndex ?? 0) - (b.chairIndex ?? 0),
        );
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

    const sortedGroups: Record<string, SidebarGuestGroup> = {};
    sortedGroupKeys.forEach((key) => {
      sortedGroups[key] = groups[key];
    });
    return sortedGroups;
  }, [guests, tables, tableMap]);

  const totalGuestCount = guests.length;
  const assignedGuestCount = guests.filter((g) => g.tableId).length;
  const unassignedGuestCount = totalGuestCount - assignedGuestCount;
  const totalSeatCount = tables.reduce((sum, table) => sum + table.capacity, 0);
  const openSeatCount = Math.max(0, totalSeatCount - assignedGuestCount);

  const filteredGuestGroups = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();

    return Object.entries(groupedGuests).flatMap(([tableId, groupData]) => {
      const isUnassigned = groupData.tableNumber === null;
      const matchesFilter =
        activeFilter === "all" ||
        (activeFilter === "unassigned" && isUnassigned) ||
        (activeFilter === "open" &&
          !isUnassigned &&
          groupData.guests.length < (groupData.tableCapacity ?? 0)) ||
        (activeFilter === "locked" && groupData.seatingLocked === true);

      if (!matchesFilter) return [];
      if (!query) {
        return [{ tableId, groupData, matchType: "none" as const }];
      }

      const tableSearchText = [
        groupData.tableLabel,
        groupData.tableNumber === null
          ? "unassigned guests"
          : `table ${groupData.tableNumber}`,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();

      if (tableSearchText.includes(query)) {
        return [{ tableId, groupData, matchType: "table" as const }];
      }

      const matchingGuests = groupData.guests.filter((guest) =>
        guest.fullName.toLocaleLowerCase().includes(query),
      );
      if (matchingGuests.length === 0) return [];

      return [
        {
          tableId,
          groupData: {
            ...groupData,
            guests: matchingGuests,
            totalGuestCount: groupData.guests.length,
          },
          matchType: "guest" as const,
        },
      ];
    });
  }, [activeFilter, groupedGuests, searchQuery]);

  const toggleGroupCollapsed = useCallback(
    (tableId: string, isUnassigned: boolean) => {
      setCollapsedGroups((current) => ({
        ...current,
        [tableId]: !(current[tableId] ?? !isUnassigned),
      }));
    },
    [],
  );

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
    if (event.key === "Enter") {
      event.preventDefault();
      const name = (newGuestNames[tableId] || "").trim();
      if (!name) return;

      let nextSeatIndex: number | null = null;
      let targetPhysicalTableId = tableId;
      if (tableId !== "unassigned") {
        for (const memberTableId of group.memberTableIds ?? [tableId]) {
          const member = tableMap.get(memberTableId);
          if (!member) continue;
          nextSeatIndex = findNextAvailableSeat(
            guests.filter((guest) => guest.tableId === memberTableId),
            member.capacity,
          );
          if (nextSeatIndex !== null) {
            targetPhysicalTableId = memberTableId;
            break;
          }
        }
        if (nextSeatIndex === null) {
          console.error("Attempted to add guest to a full table:", tableId);
          return;
        }
      }

      const newGuest: Guest = {
        id: `guest-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        fullName: name,
        tableId: tableId === "unassigned" ? "" : targetPhysicalTableId,
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
    const members = getMergedSeatingMembers(tables, tableId);
    const memberIds = new Set(members.map((member) => member.id));
    const nextLocked = !members.some((member) => member.seatingLocked === true);
    setBaseShapes((prev) =>
      prev.map((s) =>
        s.type === "table" && memberIds.has(s.id)
          ? { ...s, seatingLocked: nextLocked }
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
        className={`relative z-20 border-b border-sidebar-border/50 bg-sidebar p-4 shadow-sm ${isInSheet ? "pr-12" : ""}`}
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
        {isInSheet && <p className="mt-2 text-sm text-sidebar-foreground/65" aria-live="polite">
          <span className="font-medium text-sidebar-foreground">
            {assignedGuestCount} seated
          </span>
          <span aria-hidden="true"> · </span>
          {unassignedGuestCount} unassigned
          <span aria-hidden="true"> · </span>
          {openSeatCount} open seat{openSeatCount === 1 ? "" : "s"}
        </p>}

        <div className="relative mt-3">
          <Search
            size={16}
            strokeWidth={1.75}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sidebar-foreground/50"
          />
          <Input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Find a guest or table…"
            aria-label="Find a guest or table"
            className="h-9 border-sidebar-border/50 bg-sidebar-accent/10 pl-9 pr-9 text-sm text-sidebar-foreground placeholder:text-sidebar-foreground/45 focus-visible:ring-sidebar-ring"
          />
          {searchQuery && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-sidebar-foreground/55 hover:bg-sidebar-accent/20 hover:text-sidebar-foreground"
            >
              <X size={14} aria-hidden="true" />
            </Button>
          )}
        </div>

        <div
          className="mt-2 grid grid-cols-4 gap-1"
          role="group"
          aria-label="Filter guest list"
        >
          {SIDEBAR_FILTERS.map((filter) => {
            const isActive = activeFilter === filter.id;
            return (
              <Button
                key={filter.id}
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={isActive}
                onClick={() => setActiveFilter(filter.id)}
                className={`h-8 min-w-0 px-1 text-[11px] font-medium sm:text-xs ${
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm hover:bg-sidebar-primary/90 hover:text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/65 hover:bg-sidebar-accent/20 hover:text-sidebar-foreground"
                }`}
              >
                <span className="truncate">{filter.label}</span>
              </Button>
            );
          })}
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
      ) : filteredGuestGroups.length === 0 ? (
        <div className="relative z-10 flex flex-1 items-center justify-center px-6 text-center text-sidebar-foreground/65">
          <div>
            <Search
              size={30}
              className="mx-auto mb-3 text-sidebar-primary/45"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <p className="font-medium text-sidebar-foreground">No matches found</p>
            <p className="mt-1 text-sm leading-relaxed">
              Try another guest or table name, or change the filter.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 border-sidebar-border/50"
              onClick={() => {
                setSearchQuery("");
                setActiveFilter("all");
              }}
            >
              Clear search and filters
            </Button>
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
            {filteredGuestGroups.map(({ tableId, groupData, matchType }) => {
              const isUnassigned = groupData.tableNumber === null;
              const isSearching = searchQuery.trim().length > 0;
              const isCollapsed = isSearching
                ? false
                : (collapsedGroups[tableId] ?? !isUnassigned);
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
                  isCollapsed={isCollapsed}
                  collapseDisabled={isSearching}
                  onToggleCollapsed={() =>
                    toggleGroupCollapsed(tableId, isUnassigned)
                  }
                  onSelectTable={onSelectTable}
                  onSelectGuest={onSelectGuest}
                  showGuestJumpControls={matchType === "guest" && !isUnassigned}
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
