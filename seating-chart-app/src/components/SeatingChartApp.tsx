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
  groupDropPreviewAtom,
} from "@/lib/atoms";
import { findTableUnderPoint, computeGroupSeatPlan, type StagePoint } from "@/lib/groupSeating";
import { Guest, Table, VenueElement, BackgroundImage } from "../types/seatingChart";
import { processBackgroundImageFile } from "@/lib/backgroundImageProcessing";
import { snapToGrid } from "@/lib/gridSnap";
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
import { UserCircle, UsersRound } from "lucide-react";

// The one droppable id for "anywhere on the canvas" — landing here means
// resolving the exact chair from the drop point via Konva's own hit
// detection, rather than dnd-kit tracking a droppable per chair (there are
// no DOM nodes for canvas-rendered chairs to attach one to).
const CANVAS_DROP_ZONE_ID = "canvas-drop-zone";

// How far outside a table's own body the pointer can be while still
// counting as "hovering that table" for a group drop — wide enough to
// cover the ring of chairs sitting just outside the table edge.
const GROUP_DROP_HIT_MARGIN = 40;

type DragPayload =
  | { kind: "guest"; guest: Guest }
  | { kind: "group"; guests: Guest[]; groupLabel: string };

// Tracks whether `query` currently matches. The state used to start
// hardcoded `false` and only get corrected inside an effect after mount —
// on a genuinely desktop-width viewport, that meant every fresh mount of
// this component (a hard refresh, or reaching it for the first time after
// a PIN unlock) rendered one wrong pass as "not desktop" first: the
// sidebar swaps to its closed mobile Sheet, and the hamburger button that
// would reopen it stays hidden too, since *that's* gated by a real CSS
// breakpoint that was never wrong. Depending on timing, that wrong pass
// could be the last thing painted before data finished loading, making
// the sidebar look like it had simply vanished with no way back short of
// resizing the window. Lazily initializing from the real value up front
// removes the wrong pass entirely; listening to the MediaQueryList's own
// `change` event (rather than every window `resize`) is both more
// correct and cheaper to keep in sync afterward.
const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);
    const listener = (event: MediaQueryListEvent) => setMatches(event.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [query]);
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
  const [activeDragPayload, setActiveDragPayload] =
    useState<DragPayload | null>(null);
  const [flashErrorTableId, setFlashErrorTableId] = useState<string | null>(
    null,
  );
  const setGroupDropPreview = useSetAtom(groupDropPreviewAtom);

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
      const data = event.active.data.current as
        | { kind: "guest"; guest: Guest }
        | { kind: "group"; guests: Guest[]; groupLabel: string }
        | undefined;
      if (data?.kind === "group") {
        setActiveDragPayload({
          kind: "group",
          guests: data.guests,
          groupLabel: data.groupLabel,
        });
      } else if (data?.kind === "guest") {
        setActiveDragPayload({ kind: "guest", guest: data.guest });
      } else {
        // Fallback in case some drag source hasn't been updated to the
        // { kind, ... } data shape yet.
        const draggedGuest = guestsValue.find((g) => g.id === event.active.id);
        setActiveDragPayload(
          draggedGuest ? { kind: "guest", guest: draggedGuest } : null,
        );
      }
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

  // Resolve a canvas drop point (viewport/client coordinates) to a point in
  // the stage's own logical coordinate space — the same space table.x/y
  // live in — by inverting the stage's absolute transform (pan + zoom).
  // Used for group drops, which need to know *where inside the table* the
  // group landed rather than just which chair, so it can be routed through
  // computeGroupSeatPlan.
  const resolveStagePoint = useCallback(
    (clientX: number, clientY: number): StagePoint | null => {
      const stage = Konva.stages[Konva.stages.length - 1];
      if (!stage) return null;
      const stageBox = stage.container().getBoundingClientRect();
      const pos = { x: clientX - stageBox.left, y: clientY - stageBox.top };
      return stage.getAbsoluteTransform().copy().invert().point(pos);
    },
    [],
  );

  // Computes (or clears) the live group-drop preview for a given pointer
  // position — pulled out of the pointermove effect below so it can run on
  // every raw pointer move while a group drag is over the canvas, not just
  // when isPointerOverCanvas flips. No-ops (and clears any stale preview)
  // for anything that isn't an active group drag.
  const updateGroupDropPreview = useCallback(
    (clientX: number, clientY: number) => {
      if (activeDragPayload?.kind !== "group") return;
      const stagePoint = resolveStagePoint(clientX, clientY);
      const tables = baseShapesValue.filter(
        (s): s is Table => s.type === "table",
      );
      const hit = stagePoint
        ? findTableUnderPoint(tables, stagePoint, GROUP_DROP_HIT_MARGIN)
        : null;
      if (!hit || hit.table.seatingLocked) {
        setGroupDropPreview(null);
        return;
      }
      const occupied = new Set(
        guestsValue
          .filter(
            (g) =>
              g.tableId === hit.table.id && typeof g.chairIndex === "number",
          )
          .map((g) => g.chairIndex as number),
      );
      const plan = computeGroupSeatPlan(
        hit.table,
        occupied,
        activeDragPayload.guests.length,
        hit.localX,
        hit.localY,
      );
      setGroupDropPreview(
        plan ? { tableId: hit.table.id, chairIndexes: plan } : null,
      );
    },
    [activeDragPayload, baseShapesValue, guestsValue, resolveStagePoint, setGroupDropPreview],
  );

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      lastPointerPosRef.current = { x: event.clientX, y: event.clientY };
      if (!isDragActive || !canvasContainerRef.current) return;
      const rect = canvasContainerRef.current.getBoundingClientRect();
      const overCanvas =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      setIsPointerOverCanvas(overCanvas);
      if (overCanvas) {
        updateGroupDropPreview(event.clientX, event.clientY);
      } else if (activeDragPayload?.kind === "group") {
        setGroupDropPreview(null);
      }
    };
    window.addEventListener("pointermove", handlePointerMove, true);
    return () =>
      window.removeEventListener("pointermove", handlePointerMove, true);
  }, [isDragActive, activeDragPayload, updateGroupDropPreview, setGroupDropPreview]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const payload = activeDragPayload;
      const pointerPos = lastPointerPosRef.current;
      const wasOverCanvas = isPointerOverCanvas;
      setActiveDragPayload(null);
      setIsDragActive(false);
      setIsPointerOverCanvas(false);
      setGroupDropPreview(null);
      if (!payload) return;

      // --- Whole-party (group) drop ---------------------------------
      // One-time placement convenience only: every guest gets an ordinary,
      // independent tableId/chairIndex below, exactly as if seated one at
      // a time. No new field or relationship links them after this.
      if (payload.kind === "group") {
        const groupGuestIds = new Set(payload.guests.map((g) => g.id));

        if (wasOverCanvas && pointerPos) {
          const stagePoint = resolveStagePoint(pointerPos.x, pointerPos.y);
          const tables = baseShapesValue.filter(
            (s): s is Table => s.type === "table",
          );
          const hit = stagePoint
            ? findTableUnderPoint(tables, stagePoint, GROUP_DROP_HIT_MARGIN)
            : null;
          if (!hit) {
            toast({
              title: "Drop On A Table",
              description:
                "Drag the party onto a table to seat them together.",
              variant: "destructive",
            });
            return;
          }
          if (hit.table.seatingLocked) {
            toast({
              title: "Seating Locked",
              description: `Table ${hit.table.number}'s seating is locked. Unlock it from the sidebar to seat guests there.`,
              variant: "destructive",
            });
            return;
          }
          const occupied = new Set(
            guestsValue
              .filter(
                (g) =>
                  g.tableId === hit.table.id &&
                  typeof g.chairIndex === "number",
              )
              .map((g) => g.chairIndex as number),
          );
          const plan = computeGroupSeatPlan(
            hit.table,
            occupied,
            payload.guests.length,
            hit.localX,
            hit.localY,
          );
          if (!plan) {
            toast({
              title: "Not Enough Seats",
              description: `Table ${hit.table.number} doesn't have ${payload.guests.length} open seats together.`,
              variant: "destructive",
              duration: 2500,
            });
            setFlashErrorTableId(hit.table.id);
            setTimeout(() => setFlashErrorTableId(null), 1000);
            return;
          }
          setGuestsValue((prev) =>
            prev.map((g) => {
              const idx = payload.guests.findIndex((pg) => pg.id === g.id);
              return idx === -1
                ? g
                : { ...g, tableId: hit.table.id, chairIndex: plan[idx] };
            }),
          );
          return;
        }

        if (!over) return;
        const targetTableId = over.id as string;

        if (targetTableId === "unassigned") {
          setGuestsValue((prev) =>
            prev.map((g) =>
              groupGuestIds.has(g.id)
                ? { ...g, tableId: "", chairIndex: null }
                : g,
            ),
          );
          return;
        }

        const targetTable = baseShapesValue.find(
          (s): s is Table => s.type === "table" && s.id === targetTableId,
        );
        if (!targetTable) return;
        if (targetTable.seatingLocked) {
          toast({
            title: "Seating Locked",
            description: `Table ${targetTable.number}'s seating is locked. Unlock it from the sidebar to seat guests there.`,
            variant: "destructive",
          });
          return;
        }

        // Same greedy sequential fill single-guest sidebar drops use,
        // generalized to seat all N guests in one pass.
        const guestsAtTargetTable = guestsValue.filter(
          (g) => g.tableId === targetTableId,
        );
        const occupied = new Set(
          guestsAtTargetTable
            .map((g) => g.chairIndex)
            .filter((i): i is number => typeof i === "number"),
        );
        const openSeats: number[] = [];
        for (let i = 0; i < targetTable.capacity; i++) {
          if (!occupied.has(i)) openSeats.push(i);
        }
        if (openSeats.length < payload.guests.length) {
          toast({
            title: "Table Full",
            description: `Table ${targetTable.number} only has ${openSeats.length} open seat${openSeats.length === 1 ? "" : "s"} — the party of ${payload.guests.length} won't all fit.`,
            variant: "destructive",
            duration: 2500,
          });
          setFlashErrorTableId(targetTableId);
          setTimeout(() => setFlashErrorTableId(null), 1000);
          return;
        }
        setGuestsValue((prev) =>
          prev.map((g) => {
            const idx = payload.guests.findIndex((pg) => pg.id === g.id);
            return idx === -1
              ? g
              : { ...g, tableId: targetTableId, chairIndex: openSeats[idx] };
          }),
        );
        return;
      }

      // --- Single-guest drop (existing behavior) ---------------------
      const draggedGuest = payload.guest;
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
        const targetChairTable = baseShapesValue.find(
          (s): s is Table => s.type === "table" && s.id === target.tableId,
        );
        if (targetChairTable?.seatingLocked) {
          toast({
            title: "Seating Locked",
            description: `Table ${targetChairTable.number}'s seating is locked. Unlock it from the sidebar to seat guests there.`,
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
      if (targetTable.seatingLocked) {
        toast({
          title: "Seating Locked",
          description: `Table ${targetTable.number}'s seating is locked. Unlock it from the sidebar to seat guests there.`,
          variant: "destructive",
        });
        return;
      }
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
      activeDragPayload,
      baseShapesValue,
      findNextAvailableSeat,
      guestsValue,
      isPointerOverCanvas,
      resolveChairAtPoint,
      resolveStagePoint,
      setGroupDropPreview,
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

  // The one background-image shape, if any — a singleton by convention
  // (uploading a new one replaces it rather than adding a second).
  const backgroundImageShape = useMemo(
    () => baseShapesValue.find((s): s is BackgroundImage => s.type === "backgroundImage"),
    [baseShapesValue],
  );

  const handleUploadBackgroundImage = async (file: File) => {
    if (!editMode) {
      toast({
        title: "View-Only Mode",
        description: "Cannot add a background image while in view-only mode.",
        variant: "destructive",
      });
      return;
    }
    if (
      backgroundImageShape &&
      !window.confirm(
        "Replace the current background image with this one? This can't be undone.",
      )
    ) {
      return;
    }

    let processed;
    try {
      processed = await processBackgroundImageFile(file);
    } catch (error) {
      toast({
        title: "Couldn't Use That Image",
        description: error instanceof Error ? error.message : "Try a different file.",
        variant: "destructive",
      });
      return;
    }

    // Default placement: fit inside the venue space if one exists (so it
    // doesn't land absurdly tiny or huge relative to everything else),
    // otherwise a reasonable fixed size near the top-left of the canvas.
    const venueSpace = baseShapesValue.find(
      (s): s is VenueElement => s.type === "venue" && s.title === "Venue Space",
    );
    let scale: number;
    let x: number;
    let y: number;
    if (venueSpace) {
      scale = Math.min(
        venueSpace.width / processed.naturalWidth,
        venueSpace.height / processed.naturalHeight,
      );
      x = venueSpace.x + (venueSpace.width - processed.naturalWidth * scale) / 2;
      y = venueSpace.y + (venueSpace.height - processed.naturalHeight * scale) / 2;
    } else {
      const targetLongEdge = 600;
      const longEdge = Math.max(processed.naturalWidth, processed.naturalHeight);
      scale = targetLongEdge / longEdge;
      x = 100;
      y = 100;
    }

    const newShape: BackgroundImage = {
      type: "backgroundImage",
      id: backgroundImageShape?.id ?? `background-${Date.now()}-${nanoid(4)}`,
      dataUrl: processed.dataUrl,
      naturalWidth: processed.naturalWidth,
      naturalHeight: processed.naturalHeight,
      x: snapToGrid(x),
      y: snapToGrid(y),
      scale,
      rotation: 0,
      opacity: 1,
      locked: false,
    };

    setBaseShapes((prevShapes) =>
      backgroundImageShape
        ? prevShapes.map((s) => (s.id === backgroundImageShape.id ? newShape : s))
        : [newShape, ...prevShapes],
    );
    setSelectedShapeId(newShape.id);

    toast({
      title: backgroundImageShape ? "Background Image Replaced" : "Background Image Added",
      description: processed.wasDownscaled
        ? "It's selected — drag/resize into place. It was automatically shrunk to keep the chart fast to load."
        : "It's selected — drag to reposition, or use a corner handle to resize (aspect ratio locked).",
    });
  };

  const handleSelectBackgroundImage = () => {
    if (backgroundImageShape) {
      setSelectedShapeId(backgroundImageShape.id);
    }
  };

  const handleToggleBackgroundLock = () => {
    if (!editMode || !backgroundImageShape) return;
    const nextLocked = !backgroundImageShape.locked;
    setBaseShapes((prev) =>
      prev.map((s) => (s.id === backgroundImageShape.id ? { ...s, locked: nextLocked } : s)),
    );
    if (nextLocked && selectedShapeIdValue === backgroundImageShape.id) {
      setSelectedShapeId(null);
    }
  };

  const handleSetBackgroundOpacity = (opacity: number) => {
    if (!editMode || !backgroundImageShape) return;
    setBaseShapes((prev) =>
      prev.map((s) => (s.id === backgroundImageShape.id ? { ...s, opacity } : s)),
    );
  };

  const handleRemoveBackgroundImage = () => {
    if (!editMode || !backgroundImageShape) return;
    if (!window.confirm("Remove the background image? This can't be undone.")) return;
    setBaseShapes((prev) => prev.filter((s) => s.id !== backgroundImageShape.id));
    if (selectedShapeIdValue === backgroundImageShape.id) {
      setSelectedShapeId(null);
    }
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
        backgroundImage={backgroundImageShape ?? null}
        onUploadBackgroundImage={handleUploadBackgroundImage}
        onSelectBackgroundImage={handleSelectBackgroundImage}
        onToggleBackgroundLock={handleToggleBackgroundLock}
        onSetBackgroundOpacity={handleSetBackgroundOpacity}
        onRemoveBackgroundImage={handleRemoveBackgroundImage}
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
          {activeDragPayload?.kind === "guest" ? (
            <div className="bg-sidebar p-3 rounded-md shadow-xl border border-primary/50 flex items-center opacity-90 cursor-grabbing">
              <UserCircle size={18} className="mr-2 text-primary shrink-0" />
              <span className="font-medium text-sidebar-primary truncate">
                {activeDragPayload.guest.fullName}
              </span>
            </div>
          ) : activeDragPayload?.kind === "group" ? (
            <div className="bg-sidebar p-3 rounded-md shadow-xl border border-primary/50 flex items-center opacity-90 cursor-grabbing">
              <UsersRound size={18} className="mr-2 text-primary shrink-0" />
              <span className="font-medium text-sidebar-primary truncate">
                {activeDragPayload.groupLabel} · {activeDragPayload.guests.length} guests
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
