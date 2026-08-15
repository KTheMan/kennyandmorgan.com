import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Konva from "konva";
import { Sidebar } from "./Sidebar";
import { Header, type SaveStatus } from "./Header";
import { useToast } from "@/components/ui/use-toast";
import { useAtom, useSetAtom, useAtomValue } from "jotai";
import {
  baseShapesAtom,
  guestsAtom,
  tableCounterAtom,
  totalGuestsAtom,
  shapeAtomsAtom,
  venueSpaceLockedAtom,
  selectedShapeIdAtom,
  eventTitleAtom,
  editModeAtom,
} from "@/lib/atoms";
import { Guest, Table, VenueElement } from "../types/seatingChart";
import { GuestAssignmentModal } from "./GuestAssignmentModal";
import { RenameElementModal } from "./RenameElementModal";
import { TableSeatingModal } from "./TableSeatingModal";
import { SortedCanvasStageAdapter } from "./SortedCanvasStageAdapter";
import { useVenuePersistence, DEFAULT_VENUE_DATA, type VenueCredentials } from "@/hooks/useVenuePersistence";
import type { VenueAccess } from "@/components/VenueGate";
import { nanoid } from "nanoid";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { UserCircle } from "lucide-react";

// The one droppable id for "anywhere on the canvas" — landing here means
// resolving the exact chair from the drop point via Konva's own hit
// detection, rather than dnd-kit tracking a droppable per chair (there are
// no DOM nodes for canvas-rendered chairs to attach one to).
const CANVAS_DROP_ZONE_ID = "canvas-drop-zone";

// Placeholder for useMediaQuery hook
const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    if (media.matches !== matches) {
      setMatches(media.matches);
    }
    const listener = () => setMatches(media.matches);
    window.addEventListener("resize", listener);
    return () => window.removeEventListener("resize", listener);
  }, [matches, query]);
  return matches;
};

interface SeatingChartAppProps {
  slug: string;
  access: VenueAccess;
  hasEditPin: boolean;
  hasViewPin: boolean;
  viewPinRequired: boolean;
  onUnlockWithPin: (pin: string) => Promise<boolean>;
  onViewPinChanged: () => void;
  onBackToManager: () => void;
}

export const SeatingChartApp: React.FC<SeatingChartAppProps> = ({
  slug,
  access,
  hasEditPin,
  hasViewPin,
  viewPinRequired,
  onUnlockWithPin,
  onViewPinChanged,
  onBackToManager,
}) => {
  const { toast } = useToast();
  const isAdmin = access.kind === "admin";
  const canEdit = access.kind !== "viewer";

  const credentials: VenueCredentials = useMemo(() => {
    if (access.kind === "admin") return { token: access.token };
    if (access.kind === "editor") return { editPin: access.editPin, viewPin: access.viewPin };
    return { viewPin: access.viewPin };
  }, [access]);

  const setEditMode = useSetAtom(editModeAtom);
  useEffect(() => {
    setEditMode(canEdit);
  }, [canEdit, setEditMode]);

  const { isLoading, isSaving, serverError, updateError, loadIssue } = useVenuePersistence(
    slug,
    credentials,
    canEdit,
  );
  const editMode = useAtomValue(editModeAtom);

  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  useEffect(() => {
    if (isDesktop && isSheetOpen) {
      setIsSheetOpen(false);
    }
  }, [isDesktop, isSheetOpen]);

  const saveStatus: SaveStatus = useMemo(() => {
    if (isSaving) return "saving";
    if (updateError) return "unsaved";
    return "saved";
  }, [isSaving, updateError]);

  const setBaseShapes = useSetAtom(baseShapesAtom);
  const setGuestsValue = useSetAtom(guestsAtom);
  const setEventTitleValue = useSetAtom(eventTitleAtom);
  const [tableCounterValue, setTableCounter] = useAtom(tableCounterAtom);
  const [totalGuests] = useAtom(totalGuestsAtom);
  const [guestsValue] = useAtom(guestsAtom);
  const [shapeAtoms] = useAtom(shapeAtomsAtom);
  const [baseShapesValue] = useAtom(baseShapesAtom);
  const [isVenueLocked, setIsVenueLocked] = useAtom(venueSpaceLockedAtom);
  const [selectedShapeIdValue, setSelectedShapeId] =
    useAtom(selectedShapeIdAtom);
  const [eventTitle] = useAtom(eventTitleAtom);

  const venueSpaceExists = useMemo(
    () =>
      baseShapesValue.some(
        (shape) => shape.type === "venue" && shape.title === "Venue Space",
      ),
    [baseShapesValue],
  );

  // --- Drag-and-drop: dragging a guest from the sidebar list either onto
  // a sidebar table section (existing behavior — lands in that table's
  // next available seat) or directly onto a specific chair on the canvas
  // (new). One shared DndContext has to span both regions since a drag
  // must start and end within the same context — see the JSX below.
  const [activeDragGuest, setActiveDragGuest] = useState<Guest | null>(null);
  const [flashErrorTableId, setFlashErrorTableId] = useState<string | null>(
    null,
  );

  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { delay: 150, tolerance: 5 },
  });
  const sensors = useSensors(pointerSensor);

  // dnd-kit's own pointer-coordinate tracking (which both pointerWithin
  // and closestCenter depend on to resolve `over`) goes stale once the
  // pointer moves over the Konva canvas — table/chair dragging on the
  // canvas has its own pointer handling that appears to interfere with
  // it. So canvas drops are resolved independently: track the raw pointer
  // position ourselves (capture-phase, so it's unaffected by anything
  // downstream calling stopPropagation) and compare it directly against
  // the canvas container's rect, bypassing dnd-kit's collision system for
  // this one region. Sidebar-to-sidebar drops are unaffected and still go
  // through dnd-kit's own `over` normally.
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const lastPointerPosRef = useRef<{ x: number; y: number } | null>(
    null,
  );
  const [isDragActive, setIsDragActive] = useState(false);
  const [isPointerOverCanvas, setIsPointerOverCanvas] = useState(false);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      lastPointerPosRef.current = { x: event.clientX, y: event.clientY };
      if (!isDragActive || !canvasContainerRef.current) return;
      const rect = canvasContainerRef.current.getBoundingClientRect();
      setIsPointerOverCanvas(
        event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom,
      );
    };
    window.addEventListener("pointermove", handlePointerMove, true);
    return () =>
      window.removeEventListener("pointermove", handlePointerMove, true);
  }, [isDragActive]);

  const { setNodeRef: setCanvasDropRef } = useDroppable({
    id: CANVAS_DROP_ZONE_ID,
  });
  const setCanvasRefs = useCallback(
    (el: HTMLDivElement | null) => {
      canvasContainerRef.current = el;
      setCanvasDropRef(el);
    },
    [setCanvasDropRef],
  );

  const findNextAvailableSeat = useCallback(
    (currentGuests: Guest[], capacity: number): number | null => {
      if (currentGuests.length >= capacity) return null;
      const occupied = new Set(
        currentGuests
          .map((g) => g.chairIndex)
          .filter((i): i is number => typeof i === "number"),
      );
      for (let i = 0; i < capacity; i++) {
        if (!occupied.has(i)) return i;
      }
      return null;
    },
    [],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const draggedGuest = guestsValue.find((g) => g.id === event.active.id);
      setActiveDragGuest(draggedGuest ?? null);
      setIsDragActive(true);
      setIsPointerOverCanvas(false);
    },
    [guestsValue],
  );

  // Resolve a canvas drop point (viewport/client coordinates) to the
  // specific chair under it, via Konva's own hit detection — there's no
  // per-chair DOM node for dnd-kit to register a droppable on, since
  // chairs are shapes on a <canvas>, not DOM elements.
  const resolveChairAtPoint = useCallback(
    (clientX: number, clientY: number): { tableId: string; chairIndex: number } | null => {
      const stage = Konva.stages[Konva.stages.length - 1];
      if (!stage) return null;
      const stageBox = stage.container().getBoundingClientRect();
      const pos = { x: clientX - stageBox.left, y: clientY - stageBox.top };
      let node: Konva.Node | null = stage.getIntersection(pos);
      while (node && node !== stage) {
        const chairIndex = node.getAttr("chairIndex");
        const tableId = node.getAttr("tableId");
        if (typeof chairIndex === "number" && typeof tableId === "string") {
          return { tableId, chairIndex };
        }
        node = node.getParent();
      }
      return null;
    },
    [],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const draggedGuest = activeDragGuest;
      const pointerPos = lastPointerPosRef.current;
      const wasOverCanvas = isPointerOverCanvas;
      setActiveDragGuest(null);
      setIsDragActive(false);
      setIsPointerOverCanvas(false);
      if (!draggedGuest) return;
      const guestId = active.id as string;

      // Resolved from our own tracked pointer position, not dnd-kit's
      // `over` — see the note above isDragActive for why.
      if (wasOverCanvas && pointerPos) {
        const target = resolveChairAtPoint(pointerPos.x, pointerPos.y);
        if (!target) {
          toast({
            title: "Drop On A Seat",
            description:
              "Drag a guest directly onto an empty chair to assign them.",
            variant: "destructive",
          });
          return;
        }
        const occupant = guestsValue.find(
          (g) =>
            g.tableId === target.tableId && g.chairIndex === target.chairIndex,
        );
        if (occupant && occupant.id !== guestId) {
          toast({
            title: "Seat Taken",
            description: "That chair already has a guest — remove them first.",
            variant: "destructive",
          });
          return;
        }
        setGuestsValue((prev) =>
          prev.map((g) =>
            g.id === guestId
              ? { ...g, tableId: target.tableId, chairIndex: target.chairIndex }
              : g,
          ),
        );
        return;
      }

      if (!over || active.id === over.id) return;
      const targetTableId = over.id as string;
      if (
        draggedGuest.tableId === targetTableId &&
        targetTableId !== "unassigned"
      )
        return;

      if (targetTableId === "unassigned") {
        setGuestsValue((prev) =>
          prev.map((g) =>
            g.id === guestId ? { ...g, tableId: "", chairIndex: null } : g,
          ),
        );
        return;
      }

      const targetTable = baseShapesValue.find(
        (s): s is Table => s.type === "table" && s.id === targetTableId,
      );
      if (!targetTable) return;
      const guestsAtTargetTable = guestsValue.filter(
        (g) => g.tableId === targetTableId,
      );
      const nextSeatIndex = findNextAvailableSeat(
        guestsAtTargetTable,
        targetTable.capacity,
      );
      if (nextSeatIndex === null) {
        toast({
          title: "Table Full",
          description: `Table ${targetTable.number} has no available seats.`,
          variant: "destructive",
          duration: 2000,
        });
        setFlashErrorTableId(targetTableId);
        setTimeout(() => setFlashErrorTableId(null), 1000);
        return;
      }
      setGuestsValue((prev) =>
        prev.map((g) =>
          g.id === guestId
            ? { ...g, tableId: targetTableId, chairIndex: nextSeatIndex }
            : g,
        ),
      );
    },
    [
      activeDragGuest,
      baseShapesValue,
      findNextAvailableSeat,
      guestsValue,
      isPointerOverCanvas,
      resolveChairAtPoint,
      setGuestsValue,
      toast,
    ],
  );

  useEffect(() => {
    if (serverError) {
      toast({
        title: "Error Loading Chart",
        description:
          serverError.message || "Could not load chart data from server.",
        variant: "destructive",
      });
    }
  }, [serverError, toast]);

  useEffect(() => {
    if (loadIssue) {
      toast({
        title: "Chart Didn't Load Right",
        description: loadIssue.message,
        variant: "destructive",
      });
    }
  }, [loadIssue, toast]);

  useEffect(() => {
    if (updateError) {
      toast({
        title: "Error Saving Chart",
        description:
          (updateError as Error).message ||
          "Could not save chart data to server.",
        variant: "destructive",
      });
    }
  }, [updateError, toast]);

  const handleReset = useCallback(() => {
    if (!canEdit) return;
    if (
      window.confirm(
        "Are you sure you want to clear the canvas? Tables, venue elements, and seating assignments will be removed.",
      )
    ) {
      setBaseShapes(DEFAULT_VENUE_DATA.shapes);
      setGuestsValue(DEFAULT_VENUE_DATA.guests);
      setEventTitleValue(DEFAULT_VENUE_DATA.eventTitle);
      setTableCounter(DEFAULT_VENUE_DATA.tableCounter);
      toast({
        title: "Canvas Cleared",
        description: "Started a fresh seating chart.",
      });
    }
  }, [canEdit, setBaseShapes, setGuestsValue, setEventTitleValue, setTableCounter, toast]);

  const handleAddTable = (shape: "round" | "rectangle" = "round") => {
    if (editMode === false) {
      toast({
        title: "View-Only Mode",
        description: "Cannot add tables while in view-only mode.",
        variant: "destructive",
      });
      return;
    }
    const currentTableCounter = tableCounterValue;
    const newTable: Table =
      shape === "rectangle"
        ? {
            id: `table-${Date.now()}-${nanoid(4)}`,
            type: "table",
            shape: "rectangle",
            number: currentTableCounter,
            x: 200 + Math.random() * 200,
            y: 150 + Math.random() * 150,
            width: 200,
            height: 90,
            radius: 100, // kept in sync (half of width) for older code paths that assume a radius
            capacity: 8,
          }
        : {
            id: `table-${Date.now()}-${nanoid(4)}`,
            type: "table",
            shape: "round",
            number: currentTableCounter,
            x: 200 + Math.random() * 200,
            y: 150 + Math.random() * 150,
            radius: 60,
            capacity: 8,
          };
    setBaseShapes((prevShapes) => [...prevShapes, newTable]);
    setTableCounter((prev) => prev + 1);

    toast({
      title: "Table Added",
      description: `Table ${newTable.number} added.`,
    });
  };

  const handleAddVenueElement = () => {
    if (editMode === false) {
      toast({
        title: "View-Only Mode",
        description: "Cannot add venue elements while in view-only mode.",
        variant: "destructive",
      });
      return;
    }
    const randomHue = Math.floor(Math.random() * 360);
    const randomSaturation = 30 + Math.floor(Math.random() * 30);
    const randomLightness = 75 + Math.floor(Math.random() * 15);
    const alpha = 0.3;
    const randomColor = `hsla(${randomHue}, ${randomSaturation}%, ${randomLightness}%, ${alpha})`;

    const newElement: VenueElement = {
      id: `venue-${Date.now()}`,
      type: "venue",
      title: "New Element",
      x: 100 + Math.random() * 100,
      y: 100 + Math.random() * 100,
      width: 200,
      height: 150,
      color: randomColor,
    };
    setBaseShapes((prevShapes) => [...prevShapes, newElement]);

    toast({
      title: "Venue Element Added",
      description: "A new venue element has been added.",
    });
  };

  const handleAddVenueSpace = () => {
    if (editMode === false) {
      toast({
        title: "View-Only Mode",
        description: "Cannot add venue space while in view-only mode.",
        variant: "destructive",
      });
      return;
    }
    if (venueSpaceExists) {
      toast({
        title: "Action Denied",
        description: "A Venue Space element already exists.",
        variant: "destructive",
      });
      return;
    }

    const newId = `venuespace-${Date.now()}`;
    const newVenueSpace: VenueElement = {
      id: newId,
      type: "venue",
      title: "Venue Space",
      x: 50,
      y: 50,
      width: 800,
      height: 600,
      color: "rgba(0, 0, 0, 0)",
      stroke: "#333333",
      strokeWidth: 2,
    };

    setBaseShapes((prevShapes) => [...prevShapes, newVenueSpace]);

    setIsVenueLocked(false);
    setSelectedShapeId(newId);

    toast({
      title: "Venue Space Added",
      description:
        "The main venue area has been defined and selected. It is currently unlocked.",
    });
  };

  const handleToggleVenueLock = () => {
    if (editMode === false) {
      toast({
        title: "View-Only Mode",
        description: "Cannot toggle venue lock while in view-only mode.",
        variant: "destructive",
      });
      return;
    }
    const nextLockedState = !isVenueLocked;
    setIsVenueLocked(nextLockedState);

    const venueSpaceElement = baseShapesValue.find(
      (shape) => shape.type === "venue" && shape.title === "Venue Space",
    );
    const venueSpaceId = venueSpaceElement?.id;

    if (!nextLockedState && venueSpaceId) {
      setSelectedShapeId(venueSpaceId);
    } else if (
      nextLockedState &&
      venueSpaceId &&
      selectedShapeIdValue === venueSpaceId
    ) {
      setSelectedShapeId(null);
    }

    toast({
      title: `Venue Space ${nextLockedState ? "Locked" : "Unlocked"}`,
      description: `The Venue Space element is now ${nextLockedState ? "locked and cannot be moved/resized" : "unlocked for editing"}.`,
    });
  };

  const showAddVenueSpaceRequiredToast = () => {
    toast({
      title: "Action Unavailable",
      description:
        "Please add and define the Venue Space first before adding tables or other elements.",
      variant: "destructive",
      duration: 3000,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p>Loading Chart...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        slug={slug}
        isAdmin={isAdmin}
        hasEditPin={hasEditPin}
        hasViewPin={hasViewPin}
        viewPinRequired={viewPinRequired}
        onUnlockWithPin={onUnlockWithPin}
        onViewPinChanged={onViewPinChanged}
        onBackToManager={onBackToManager}
        totalGuests={totalGuests}
        onReset={handleReset}
        onAddTable={handleAddTable}
        onAddVenueElement={handleAddVenueElement}
        onAddVenueSpace={handleAddVenueSpace}
        isVenueSpacePresent={venueSpaceExists}
        isVenueSpaceLocked={isVenueLocked}
        onToggleVenueLock={handleToggleVenueLock}
        onShowDisabledInfo={showAddVenueSpaceRequiredToast}
        saveStatus={saveStatus}
        onToggleMobileSidebar={() => setIsSheetOpen((prev) => !prev)}
        isMobileSidebarOpen={isSheetOpen}
      />
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        collisionDetection={closestCenter}
      >
        <div className="flex flex-1 overflow-hidden">
          {isDesktop ? (
            <Sidebar
              guests={guestsValue}
              tables={baseShapesValue.filter(
                (s): s is Table => s.type === "table",
              )}
              isAdmin={isAdmin}
              flashErrorTableId={flashErrorTableId}
            />
          ) : (
            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
              <SheetContent
                side="left"
                className="w-72 sm:w-80 p-0 overflow-y-auto"
              >
                <SheetHeader className="p-5 pb-2 sr-only">
                  <SheetTitle>Guest List and Tables</SheetTitle>
                </SheetHeader>
                <Sidebar
                  guests={guestsValue}
                  tables={baseShapesValue.filter(
                    (s): s is Table => s.type === "table",
                  )}
                  isAdmin={isAdmin}
                  isInSheet={true}
                  flashErrorTableId={flashErrorTableId}
                />
              </SheetContent>
            </Sheet>
          )}
          <div className="flex-1 flex flex-col p-4 md:p-5 border-l border-border/40 bg-background/50">
            <div
              ref={setCanvasRefs}
              className={`flex-1 relative rounded-lg border shadow-md overflow-hidden transition-colors ${
                isPointerOverCanvas
                  ? "border-primary ring-2 ring-primary/40"
                  : "border-border/40"
              }`}
              tabIndex={1}
            >
              <SortedCanvasStageAdapter shapeAtoms={shapeAtoms} />
            </div>
          </div>
        </div>

        <DragOverlay>
          {activeDragGuest ? (
            <div className="bg-sidebar p-3 rounded-md shadow-xl border border-primary/50 flex items-center opacity-90 cursor-grabbing">
              <UserCircle size={18} className="mr-2 text-primary shrink-0" />
              <span className="font-medium text-sidebar-primary truncate">
                {activeDragGuest.fullName}
              </span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <GuestAssignmentModal />
      <RenameElementModal />
      <TableSeatingModal />
    </div>
  );
};
