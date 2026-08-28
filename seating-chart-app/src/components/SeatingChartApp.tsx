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
  selectedTableIdsAtom,
  tableSeatingModalStateAtom,
  hoveredGuestIdAtom,
  eventTitleAtom,
  editModeAtom,
  groupDropPreviewAtom,
  tableFocusRequestAtom,
  venueVersionsAtom,
  venueVersionBackgroundAssetsAtom,
} from "@/lib/atoms";
import { findTableUnderPoint, computeGroupSeatPlan, type StagePoint } from "@/lib/groupSeating";
import { Guest, Table, VenueElement, BackgroundImage } from "../types/seatingChart";
import { processBackgroundImageFile } from "@/lib/backgroundImageProcessing";
import { snapToGrid } from "@/lib/gridSnap";
import { GuestAssignmentModal } from "./GuestAssignmentModal";
import { RenameElementModal } from "./RenameElementModal";
import { TableSeatingModal } from "./TableSeatingModal";
import { TableInspector } from "./TableInspector";
import { ChartVersionsDialog } from "./ChartVersionsDialog";
import { SortedCanvasStageAdapter } from "./SortedCanvasStageAdapter";
import { useVenuePersistence, DEFAULT_VENUE_DATA, type VenueCredentials } from "@/hooks/useVenuePersistence";
import type { VenueAccess } from "@/components/VenueGate";
import { nanoid } from "nanoid";
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
import { LayoutGrid, UserCircle, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { findDuplicateTablePosition } from "@/lib/tablePlacement";
import { compactGuestsAfterSeatRemoval, findSeatToRemove } from "@/lib/seatRemoval";
import {
  getMergedSeatingMembers,
  getLinkedTableComponent,
  restoreGuestsAfterSeatInsertions,
  restoredCapacityAfterUnlink,
  TABLE_EDGES,
} from "@/lib/tableLinks";
import { useVenueHistory } from "@/hooks/useVenueHistory";
import type { VenueVersion } from "@shared/types/venue";
import {
  createVersionSnapshot,
  hydrateVersionSnapshot,
  MAX_SAVED_VERSIONS,
  pruneVersionAssets,
  versionAssetSaveError,
  versionSaveError,
} from "@/lib/venueVersions";
import { downloadSeatingSpreadsheet } from "@/lib/seatingSpreadsheet";

// The one droppable id for "anywhere on the canvas" — landing here means
// resolving the exact chair from the drop point via Konva's own hit
// detection, rather than dnd-kit tracking a droppable per chair (there are
// no DOM nodes for canvas-rendered chairs to attach one to).
const CANVAS_DROP_ZONE_ID = "canvas-drop-zone";

// How far outside a table's own body the pointer can be while still
// counting as "hovering that table" for a group drop — wide enough to
// cover the ring of chairs sitting just outside the table edge.
const GROUP_DROP_HIT_MARGIN = 40;
const MIN_TABLE_CAPACITY = 6;
const MAX_TABLE_CAPACITY = 12;

const nextAvailableTableNumber = (preferred: number, tables: Table[]) => {
  const usedNumbers = new Set(tables.map((table) => table.number));
  let candidate = Math.max(1, preferred);
  while (usedNumbers.has(candidate)) candidate += 1;
  return candidate;
};

// dnd-kit's default auto-scroller considers every scrollable ancestor,
// including the page and canvas shell. A sidebar drag should only ever
// auto-scroll the sidebar's vertical viewport.
const canAutoScrollSidebar = (element: Element) =>
  element.hasAttribute("data-radix-scroll-area-viewport") &&
  Boolean(element.closest("[data-seating-sidebar]"));

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

  const { isLoading, isSaving, serverError, updateError, loadIssue, loadRevision } = useVenuePersistence(
    slug,
    credentials,
    canEdit,
  );
  const editMode = useAtomValue(editModeAtom);

  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [mobileTask, setMobileTask] = useState<"guests" | "layout">("guests");

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
  const [selectedTableIds, setSelectedTableIds] = useAtom(selectedTableIdsAtom);
  const setTableSeatingModalState = useSetAtom(tableSeatingModalStateAtom);
  const setHoveredGuestId = useSetAtom(hoveredGuestIdAtom);
  const setTableFocusRequest = useSetAtom(tableFocusRequestAtom);
  const [eventTitle] = useAtom(eventTitleAtom);
  const [versions, setVersions] = useAtom(venueVersionsAtom);
  const [versionBackgroundAssets, setVersionBackgroundAssets] = useAtom(venueVersionBackgroundAssetsAtom);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [deletedVersion, setDeletedVersion] = useState<{
    version: VenueVersion;
    originalIndex: number;
    assets: Record<string, string>;
  } | null>(null);
  const venueHistory = useVenueHistory(slug, loadRevision);

  const venueSpaceExists = useMemo(
    () =>
      baseShapesValue.some(
        (shape) => shape.type === "venue" && shape.title === "Venue Space",
      ),
    [baseShapesValue],
  );
  const tablesValue = useMemo(
    () => baseShapesValue.filter((shape): shape is Table => shape.type === "table"),
    [baseShapesValue],
  );
  const assignedGuestCount = useMemo(
    () => guestsValue.filter((guest) => Boolean(guest.tableId)).length,
    [guestsValue],
  );
  const unassignedGuestCount = totalGuests - assignedGuestCount;
  const openSeatCount = Math.max(
    0,
    tablesValue.reduce((total, table) => total + table.capacity, 0) - assignedGuestCount,
  );
  const selectedTable = useMemo(() => {
    if (!selectedShapeIdValue) return null;
    const shape = baseShapesValue.find(
      (candidate): candidate is Table =>
        candidate.type === "table" && candidate.id === selectedShapeIdValue,
    );
    return shape ?? null;
  }, [baseShapesValue, selectedShapeIdValue]);
  const selectedTableOccupiedSeats = useMemo(
    () =>
      selectedTable
        ? guestsValue.filter((guest) => guest.tableId === selectedTable.id).length
        : 0,
    [guestsValue, selectedTable],
  );
  const occupiedChairIndexesByTable = useMemo(() => {
    const occupiedByTable = new Map<string, Set<number>>();
    for (const guest of guestsValue) {
      if (!guest.tableId || typeof guest.chairIndex !== "number") continue;
      let occupied = occupiedByTable.get(guest.tableId);
      if (!occupied) {
        occupied = new Set<number>();
        occupiedByTable.set(guest.tableId, occupied);
      }
      occupied.add(guest.chairIndex);
    }
    return occupiedByTable;
  }, [guestsValue]);

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
  const previewFrameRef = useRef<number | null>(null);
  const pendingPreviewPointRef = useRef<{ x: number; y: number } | null>(null);
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
      const hit = stagePoint
        ? findTableUnderPoint(tablesValue, stagePoint, GROUP_DROP_HIT_MARGIN)
        : null;
      if (!hit || hit.table.seatingLocked) {
        setGroupDropPreview(null);
        return;
      }
      const occupied = occupiedChairIndexesByTable.get(hit.table.id) ?? new Set<number>();
      const plan = computeGroupSeatPlan(
        hit.table,
        occupied,
        activeDragPayload.guests.length,
        hit.localX,
        hit.localY,
      );
      const nextPreview = plan ? { tableId: hit.table.id, chairIndexes: plan } : null;
      setGroupDropPreview((currentPreview) => {
        if (currentPreview === nextPreview) return currentPreview;
        if (!currentPreview || !nextPreview) return nextPreview;
        if (
          currentPreview.tableId === nextPreview.tableId &&
          currentPreview.chairIndexes.length === nextPreview.chairIndexes.length &&
          currentPreview.chairIndexes.every(
            (chairIndex, index) => chairIndex === nextPreview.chairIndexes[index],
          )
        ) {
          return currentPreview;
        }
        return nextPreview;
      });
    },
    [
      activeDragPayload,
      occupiedChairIndexesByTable,
      resolveStagePoint,
      setGroupDropPreview,
      tablesValue,
    ],
  );

  const scheduleGroupDropPreview = useCallback(
    (clientX: number, clientY: number) => {
      pendingPreviewPointRef.current = { x: clientX, y: clientY };
      if (previewFrameRef.current !== null) return;
      previewFrameRef.current = requestAnimationFrame(() => {
        previewFrameRef.current = null;
        const point = pendingPreviewPointRef.current;
        pendingPreviewPointRef.current = null;
        if (point) updateGroupDropPreview(point.x, point.y);
      });
    },
    [updateGroupDropPreview],
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
      if (overCanvas && activeDragPayload?.kind === "group") {
        scheduleGroupDropPreview(event.clientX, event.clientY);
      } else if (activeDragPayload?.kind === "group") {
        if (previewFrameRef.current !== null) {
          cancelAnimationFrame(previewFrameRef.current);
          previewFrameRef.current = null;
        }
        pendingPreviewPointRef.current = null;
        setGroupDropPreview(null);
      }
    };
    window.addEventListener("pointermove", handlePointerMove, true);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      if (previewFrameRef.current !== null) {
        cancelAnimationFrame(previewFrameRef.current);
        previewFrameRef.current = null;
      }
      pendingPreviewPointRef.current = null;
    };
  }, [isDragActive, activeDragPayload, scheduleGroupDropPreview, setGroupDropPreview]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const payload = activeDragPayload;
      const pointerPos = lastPointerPosRef.current;
      const wasOverCanvas = isPointerOverCanvas;
      if (previewFrameRef.current !== null) {
        cancelAnimationFrame(previewFrameRef.current);
        previewFrameRef.current = null;
      }
      pendingPreviewPointRef.current = null;
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
        const groupGuestIndex = new Map(
          payload.guests.map((guest, index) => [guest.id, index]),
        );

        if (wasOverCanvas && pointerPos) {
          const stagePoint = resolveStagePoint(pointerPos.x, pointerPos.y);
          const hit = stagePoint
            ? findTableUnderPoint(tablesValue, stagePoint, GROUP_DROP_HIT_MARGIN)
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
              const idx = groupGuestIndex.get(g.id);
              return idx === undefined
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
        const targetMembers = getMergedSeatingMembers(tablesValue, targetTableId);
        if (targetMembers.some((member) => member.seatingLocked)) {
          toast({
            title: "Seating Locked",
            description: `Table ${targetTable.number}'s seating is locked. Unlock it from the sidebar to seat guests there.`,
            variant: "destructive",
          });
          return;
        }

        // Same greedy sequential fill single-guest sidebar drops use,
        // generalized to seat all N guests in one pass.
        const openSeats: { tableId: string; chairIndex: number }[] = [];
        const targetMemberIds = new Set(targetMembers.map((member) => member.id));
        if (payload.guests.every((guest) => targetMemberIds.has(guest.tableId))) return;
        for (const member of targetMembers) {
          const occupied = new Set(
            guestsValue
              .filter(
                (guest) =>
                  guest.tableId === member.id && !groupGuestIds.has(guest.id),
              )
              .map((guest) => guest.chairIndex)
              .filter((index): index is number => typeof index === "number"),
          );
          for (let index = 0; index < member.capacity; index += 1) {
            if (!occupied.has(index)) openSeats.push({ tableId: member.id, chairIndex: index });
          }
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
            const idx = groupGuestIndex.get(g.id);
            return idx === undefined
              ? g
              : {
                  ...g,
                  tableId: openSeats[idx].tableId,
                  chairIndex: openSeats[idx].chairIndex,
                };
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
      const targetMembers = getMergedSeatingMembers(tablesValue, targetTableId);
      if (targetMembers.some((member) => member.seatingLocked)) {
        toast({
          title: "Seating Locked",
          description: `Table ${targetTable.number}'s seating is locked. Unlock it from the sidebar to seat guests there.`,
          variant: "destructive",
        });
        return;
      }
      if (targetMembers.some((member) => member.id === draggedGuest.tableId)) return;
      let nextSeat: { tableId: string; chairIndex: number } | null = null;
      for (const member of targetMembers) {
        const nextSeatIndex = findNextAvailableSeat(
          guestsValue.filter((guest) => guest.tableId === member.id),
          member.capacity,
        );
        if (nextSeatIndex !== null) {
          nextSeat = { tableId: member.id, chairIndex: nextSeatIndex };
          break;
        }
      }
      if (nextSeat === null) {
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
            ? { ...g, tableId: nextSeat.tableId, chairIndex: nextSeat.chairIndex }
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
      tablesValue,
      toast,
    ],
  );

  const handleDragCancel = useCallback(() => {
    if (previewFrameRef.current !== null) {
      cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
    pendingPreviewPointRef.current = null;
    setActiveDragPayload(null);
    setIsDragActive(false);
    setIsPointerOverCanvas(false);
    setGroupDropPreview(null);
  }, [setGroupDropPreview]);

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
    const currentTableCounter = nextAvailableTableNumber(tableCounterValue, tablesValue);
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
    setTableCounter(currentTableCounter + 1);

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
    setSelectedTableIds(new Set());
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
      setSelectedTableIds(new Set());
      setSelectedShapeId(venueSpaceId);
    } else if (
      nextLockedState &&
      venueSpaceId &&
      selectedShapeIdValue === venueSpaceId
    ) {
      setSelectedTableIds(new Set());
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
    setSelectedTableIds(new Set());
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
      setSelectedTableIds(new Set());
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
      setSelectedTableIds(new Set());
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
      setSelectedTableIds(new Set());
      setSelectedShapeId(null);
    }
  };

  const handleClearTableSelection = useCallback(() => {
    setSelectedTableIds(new Set());
    setSelectedShapeId(null);
  }, [setSelectedShapeId, setSelectedTableIds]);

  const handleOpenSelectedTableLayout = useCallback(() => {
    if (!selectedTable || selectedTable.shape !== "rectangle") return;
    setTableSeatingModalState({ isOpen: true, tableId: selectedTable.id });
  }, [selectedTable, setTableSeatingModalState]);

  const handleRenameSelectedTable = useCallback(() => {
    if (!selectedTable || !editMode) return;
    const nextValue = window.prompt(
      "Enter a table number",
      String(selectedTable.number),
    );
    if (nextValue === null) return;
    const nextNumber = Number.parseInt(nextValue.trim(), 10);
    if (!Number.isInteger(nextNumber) || nextNumber < 1) {
      toast({
        title: "Invalid Table Number",
        description: "Use a whole number greater than zero.",
        variant: "destructive",
      });
      return;
    }
    if (
      tablesValue.some(
        (table) => table.id !== selectedTable.id && table.number === nextNumber,
      )
    ) {
      toast({
        title: "Table Number In Use",
        description: `Table ${nextNumber} already exists.`,
        variant: "destructive",
      });
      return;
    }
    setBaseShapes((previous) =>
      previous.map((shape) =>
        shape.type === "table" && shape.id === selectedTable.id
          ? { ...shape, number: nextNumber }
          : shape,
      ),
    );
    setTableCounter((current) => Math.max(current, nextNumber + 1));
  }, [editMode, selectedTable, setBaseShapes, setTableCounter, tablesValue, toast]);

  const handleSelectedTableCapacityChange = useCallback(
    (change: -1 | 1) => {
      if (!selectedTable || !editMode) return;
      if (
        selectedTable.shape === "rectangle" &&
        selectedTable.seatingStyle === "opposing"
      ) {
        handleOpenSelectedTableLayout();
        return;
      }
      if (change < 0) {
        if (selectedTable.capacity <= MIN_TABLE_CAPACITY) return;
        const removedChairIndex = findSeatToRemove(
          guestsValue,
          selectedTable.id,
          0,
          selectedTable.capacity,
        );
        if (removedChairIndex === null) {
          toast({
            title: "Cannot Reduce Capacity",
            description: "Every seat is occupied. Remove a guest first.",
            variant: "destructive",
          });
          return;
        }
        setGuestsValue((previous) =>
          compactGuestsAfterSeatRemoval(
            previous,
            selectedTable.id,
            removedChairIndex,
          ),
        );
      }
      setBaseShapes((previous) =>
        previous.map((shape) =>
          shape.type === "table" && shape.id === selectedTable.id
            ? {
                ...shape,
                capacity: Math.max(
                  MIN_TABLE_CAPACITY,
                  Math.min(MAX_TABLE_CAPACITY, shape.capacity + change),
                ),
              }
            : shape,
        ),
      );
    },
    [
      editMode,
      guestsValue,
      handleOpenSelectedTableLayout,
      selectedTable,
      setBaseShapes,
      setGuestsValue,
      toast,
    ],
  );

  const handleDuplicateSelectedTable = useCallback(() => {
    if (!selectedTable || !editMode) return;
    const venue = baseShapesValue.find(
      (shape): shape is VenueElement =>
        shape.type === "venue" && shape.title === "Venue Space",
    );
    const position = findDuplicateTablePosition(selectedTable, tablesValue, venue);
    const duplicateNumber = nextAvailableTableNumber(tableCounterValue, tablesValue);
    const duplicate: Table = {
      ...selectedTable,
      id: `table-${Date.now()}-${nanoid(4)}`,
      number: duplicateNumber,
      ...position,
      locked: false,
      seatingLocked: false,
      linkedEdges: undefined,
      linkedSeatingMerged: false,
    };
    setBaseShapes((previous) => [...previous, duplicate]);
    setTableCounter(duplicateNumber + 1);
    setSelectedTableIds(new Set([duplicate.id]));
    setSelectedShapeId(duplicate.id);
  }, [
    baseShapesValue,
    editMode,
    selectedTable,
    setBaseShapes,
    setSelectedShapeId,
    setSelectedTableIds,
    setTableCounter,
    tableCounterValue,
    tablesValue,
  ]);

  const handleToggleSelectedTableLock = useCallback(() => {
    if (!selectedTable || !editMode) return;
    const linkedTables = getLinkedTableComponent(tablesValue, selectedTable.id);
    const linkedIds = new Set(linkedTables.map((table) => table.id));
    const nextLocked = !linkedTables.some((table) => table.locked === true);
    setBaseShapes((previous) =>
      previous.map((shape) =>
        shape.type === "table" && linkedIds.has(shape.id)
          ? { ...shape, locked: nextLocked }
          : shape,
      ),
    );
  }, [editMode, selectedTable, setBaseShapes, tablesValue]);

  const handleDeleteSelectedTable = useCallback(() => {
    if (!selectedTable || !editMode) return;
    const idsToDelete =
      selectedTableIds.size > 0
        ? new Set(selectedTableIds)
        : new Set([selectedTable.id]);
    const tableLabel =
      idsToDelete.size === 1 ? `Table ${selectedTable.number}` : `${idsToDelete.size} linked tables`;
    if (!window.confirm(`Delete ${tableLabel}? Assigned guests will move to Unassigned.`)) {
      return;
    }

    const restorations = tablesValue
      .filter((table) => !idsToDelete.has(table.id))
      .flatMap((table) =>
        TABLE_EDGES.flatMap((edge) => {
          const link = table.linkedEdges?.[edge];
          return link && idsToDelete.has(link.tableId)
            ? [{ tableId: table.id, indexes: link.removedSeatIndexes ?? [] }]
            : [];
        }),
      );
    setGuestsValue((previous) => {
      const restored = restorations.reduce(
        (current, restoration) =>
          restoreGuestsAfterSeatInsertions(
            current,
            restoration.tableId,
            restoration.indexes,
          ),
        previous,
      );
      return restored.map((guest) =>
        idsToDelete.has(guest.tableId)
          ? { ...guest, tableId: "", chairIndex: null }
          : guest,
      );
    });
    setBaseShapes((previous) =>
      previous
        .filter((shape) => !idsToDelete.has(shape.id))
        .map((shape) => {
          if (shape.type !== "table") return shape;
          const linkedEdge = TABLE_EDGES.find((edge) => {
            const linkedId = shape.linkedEdges?.[edge]?.tableId;
            return linkedId ? idsToDelete.has(linkedId) : false;
          });
          if (!linkedEdge) return shape;
          const linkedEdges = { ...shape.linkedEdges };
          delete linkedEdges[linkedEdge];
          return {
            ...shape,
            ...restoredCapacityAfterUnlink(shape, linkedEdge),
            linkedEdges,
            linkedSeatingMerged: false,
          };
        }),
    );
    handleClearTableSelection();
  }, [
    editMode,
    handleClearTableSelection,
    selectedTable,
    selectedTableIds,
    setBaseShapes,
    setGuestsValue,
    tablesValue,
  ]);

  const handleFocusTableFromSidebar = useCallback(
    (tableId: string) => {
      const table = tablesValue.find((candidate) => candidate.id === tableId);
      if (!table) return;
      const componentIds = new Set(
        getLinkedTableComponent(tablesValue, table.id).map((member) => member.id),
      );
      setSelectedTableIds(componentIds);
      setSelectedShapeId(table.id);
      setMobileTask("layout");
      setTableFocusRequest((current) => ({
        tableId: table.id,
        requestId: (current?.requestId ?? 0) + 1,
      }));
    },
    [setSelectedShapeId, setSelectedTableIds, setTableFocusRequest, tablesValue],
  );

  const handleFocusGuestFromSidebar = useCallback(
    (guest: Guest) => {
      if (!guest.tableId) return;
      setHoveredGuestId(guest.id);
      handleFocusTableFromSidebar(guest.tableId);
      window.setTimeout(() => setHoveredGuestId(null), 2500);
    },
    [handleFocusTableFromSidebar, setHoveredGuestId],
  );

  const handleSaveVersion = useCallback((name: string) => {
    const normalizedName = name.trim();
    const saveError = versionSaveError(normalizedName, versions);
    if (saveError) {
      toast({
        title: versions.length >= MAX_SAVED_VERSIONS ? "Version Limit Reached" : "Version Name Already Used",
        description: saveError,
        variant: "destructive",
      });
      return false;
    }
    const serialized = createVersionSnapshot(venueHistory.currentSnapshot, versionBackgroundAssets);
    const assetSaveError = versionAssetSaveError(serialized.assets);
    if (assetSaveError) {
      toast({
        title: "Version Storage Full",
        description: assetSaveError,
        variant: "destructive",
      });
      return false;
    }
    const version: VenueVersion = {
      id: `version-${Date.now()}-${nanoid(5)}`,
      name: normalizedName,
      createdAt: new Date().toISOString(),
      data: structuredClone(serialized.data),
    };
    setVersionBackgroundAssets(serialized.assets);
    setVersions((current) => [version, ...current]);
    toast({
      title: "Version Saved",
      description: `${normalizedName} now preserves this configuration.`,
    });
    return true;
  }, [setVersionBackgroundAssets, setVersions, toast, venueHistory.currentSnapshot, versionBackgroundAssets, versions]);

  const handleRestoreVersion = useCallback((version: VenueVersion) => {
    if (!editMode) return;
    if (!window.confirm(`Restore “${version.name}”? Your current layout remains available with Undo.`)) return;
    try {
      venueHistory.restoreSnapshot(hydrateVersionSnapshot(version.data, versionBackgroundAssets));
    } catch (error) {
      toast({
        title: "Couldn't Restore Version",
        description: error instanceof Error ? error.message : "The saved configuration is incomplete.",
        variant: "destructive",
      });
      return;
    }
    setVersionsOpen(false);
    toast({
      title: "Version Restored",
      description: `${version.name} is now the active configuration. You can undo this restore.`,
    });
  }, [editMode, toast, venueHistory, versionBackgroundAssets]);

  const handleDeleteVersion = useCallback((version: VenueVersion) => {
    if (!editMode) return;
    if (!window.confirm(`Delete saved version “${version.name}”?`)) return;
    const originalIndex = versions.findIndex((candidate) => candidate.id === version.id);
    const removedAssetIds = version.data.shapes.flatMap((shape) =>
      shape.type === "backgroundImage" && shape.versionAssetId ? [shape.versionAssetId] : [],
    );
    const removedAssets = Object.fromEntries(
      removedAssetIds.flatMap((assetId) =>
        versionBackgroundAssets[assetId] ? [[assetId, versionBackgroundAssets[assetId]]] : [],
      ),
    );
    const nextVersions = versions.filter((candidate) => candidate.id !== version.id);
    setVersions(nextVersions);
    setVersionBackgroundAssets(pruneVersionAssets(nextVersions, versionBackgroundAssets));
    setDeletedVersion({ version, originalIndex, assets: removedAssets });
    toast({
      title: "Version Deleted",
      description: `${version.name} was removed. Undo is available in Saved versions.`,
    });
  }, [editMode, setVersionBackgroundAssets, setVersions, toast, versionBackgroundAssets, versions]);

  const handleUndoDeleteVersion = useCallback(() => {
    if (!deletedVersion) return;
    setVersions((current) => {
      if (current.some((candidate) => candidate.id === deletedVersion.version.id)) return current;
      const restored = [...current];
      restored.splice(Math.max(0, deletedVersion.originalIndex), 0, deletedVersion.version);
      return restored;
    });
    setVersionBackgroundAssets((current) => ({ ...current, ...deletedVersion.assets }));
    setDeletedVersion(null);
  }, [deletedVersion, setVersionBackgroundAssets, setVersions]);

  const handleExportSpreadsheet = useCallback(() => {
    downloadSeatingSpreadsheet(tablesValue, guestsValue);
    toast({
      title: "Spreadsheet Downloaded",
      description: `Exported ${assignedGuestCount} seated guest${assignedGuestCount === 1 ? "" : "s"}, sorted by table and seat.`,
    });
  }, [assignedGuestCount, guestsValue, tablesValue, toast]);

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
        assignedGuests={assignedGuestCount}
        unassignedGuests={unassignedGuestCount}
        openSeats={openSeatCount}
        onReset={handleReset}
        onAddTable={handleAddTable}
        onAddVenueElement={handleAddVenueElement}
        onAddVenueSpace={handleAddVenueSpace}
        isVenueSpacePresent={venueSpaceExists}
        isVenueSpaceLocked={isVenueLocked}
        onToggleVenueLock={handleToggleVenueLock}
        saveStatus={saveStatus}
        onToggleMobileSidebar={() => setMobileTask((current) => current === "guests" ? "layout" : "guests")}
        isMobileSidebarOpen={mobileTask === "guests"}
        showMobileSidebarToggle={false}
        backgroundImage={backgroundImageShape ?? null}
        onUploadBackgroundImage={handleUploadBackgroundImage}
        onSelectBackgroundImage={handleSelectBackgroundImage}
        onToggleBackgroundLock={handleToggleBackgroundLock}
        onSetBackgroundOpacity={handleSetBackgroundOpacity}
        onRemoveBackgroundImage={handleRemoveBackgroundImage}
        canUndo={venueHistory.canUndo}
        canRedo={venueHistory.canRedo}
        undoDepth={venueHistory.undoDepth}
        redoDepth={venueHistory.redoDepth}
        onUndo={venueHistory.undo}
        onRedo={venueHistory.redo}
        onOpenVersions={() => setVersionsOpen(true)}
        versionCount={versions.length}
        onExportSpreadsheet={handleExportSpreadsheet}
      />
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
        collisionDetection={closestCenter}
        autoScroll={{
          canScroll: canAutoScrollSidebar,
          acceleration: 8,
          threshold: { x: 0.15, y: 0.12 },
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {!isDesktop && (
            <div
              className="grid grid-cols-2 gap-1 border-b border-border/50 bg-card/95 p-2"
              role="tablist"
              aria-label="Planner task"
              data-mobile-task-switcher
            >
              <Button
                type="button"
                role="tab"
                aria-selected={mobileTask === "guests"}
                variant={mobileTask === "guests" ? "default" : "ghost"}
                className="h-10"
                onClick={() => setMobileTask("guests")}
              >
                <UsersRound className="mr-2 h-4 w-4" aria-hidden="true" />
                Guests
              </Button>
              <Button
                type="button"
                role="tab"
                aria-selected={mobileTask === "layout"}
                variant={mobileTask === "layout" ? "default" : "ghost"}
                className="h-10"
                onClick={() => setMobileTask("layout")}
              >
                <LayoutGrid className="mr-2 h-4 w-4" aria-hidden="true" />
                Layout
              </Button>
            </div>
          )}
          <div className="flex min-h-0 flex-1 overflow-hidden">
          {(isDesktop || mobileTask === "guests") && (
            <Sidebar
              guests={guestsValue}
              tables={tablesValue}
              isAdmin={isAdmin}
              isInSheet={!isDesktop}
              flashErrorTableId={flashErrorTableId}
              onSelectTable={handleFocusTableFromSidebar}
              onSelectGuest={handleFocusGuestFromSidebar}
            />
          )}
          {(isDesktop || mobileTask === "layout") && (
          <div className="relative flex min-w-0 flex-1 overflow-hidden border-l border-border/40 bg-background/50">
            <div className="min-w-0 flex-1 flex flex-col p-3 md:p-5">
            <div
              ref={setCanvasRefs}
              className={`flex-1 relative rounded-lg border shadow-md overflow-hidden transition-colors ${
                isPointerOverCanvas
                  ? "border-primary ring-2 ring-primary/40"
                  : "border-border/40"
              }`}
              tabIndex={0}
              role="region"
              aria-label="Interactive seating layout. Select a table to open its labeled controls."
            >
              <SortedCanvasStageAdapter shapeAtoms={shapeAtoms} />
            </div>
            </div>
            {selectedTable && editMode && (
              <div
                className={isDesktop
                  ? "w-80 shrink-0 overflow-y-auto border-l border-border/50 bg-card/70 p-3"
                  : "absolute inset-x-3 bottom-3 z-30 max-h-[48%] overflow-y-auto"
                }
              >
                <TableInspector
                  table={selectedTable}
                  occupiedSeats={selectedTableOccupiedSeats}
                  onClearSelection={handleClearTableSelection}
                  onOpenSeatingLayout={handleOpenSelectedTableLayout}
                  onRename={handleRenameSelectedTable}
                  onDecreaseCapacity={() => handleSelectedTableCapacityChange(-1)}
                  onIncreaseCapacity={() => handleSelectedTableCapacityChange(1)}
                  canDecreaseCapacity={
                    selectedTable.capacity > MIN_TABLE_CAPACITY &&
                    selectedTableOccupiedSeats < selectedTable.capacity
                  }
                  canIncreaseCapacity={selectedTable.capacity < MAX_TABLE_CAPACITY}
                  onDuplicate={handleDuplicateSelectedTable}
                  onTogglePositionLock={handleToggleSelectedTableLock}
                  onDelete={handleDeleteSelectedTable}
                />
              </div>
            )}
          </div>
          )}
          </div>
        </div>

        <DragOverlay zIndex={1000}>
          {activeDragPayload?.kind === "guest" ? (
            <div className="pointer-events-none flex w-max max-w-[calc(100vw-2rem)] cursor-grabbing items-center rounded-md border border-primary/50 bg-sidebar p-3 opacity-95 shadow-xl">
              <UserCircle size={18} className="mr-2 text-primary shrink-0" />
              <span className="min-w-0 max-w-72 truncate font-medium text-sidebar-primary">
                {activeDragPayload.guest.fullName}
              </span>
            </div>
          ) : activeDragPayload?.kind === "group" ? (
            <div className="pointer-events-none flex w-max max-w-[calc(100vw-2rem)] cursor-grabbing items-center rounded-md border border-primary/50 bg-sidebar p-3 opacity-95 shadow-xl">
              <UsersRound size={18} className="mr-2 text-primary shrink-0" />
              <span className="min-w-0 max-w-72 truncate font-medium text-sidebar-primary">
                {activeDragPayload.groupLabel} · {activeDragPayload.guests.length} guests
              </span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <ChartVersionsDialog
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        versions={versions}
        canEdit={editMode}
        historyLimit={venueHistory.historyLimit}
        onSaveVersion={handleSaveVersion}
        onRestoreVersion={handleRestoreVersion}
        onDeleteVersion={handleDeleteVersion}
        deletedVersionName={deletedVersion?.version.name}
        onUndoDeleteVersion={handleUndoDeleteVersion}
      />
      <GuestAssignmentModal />
      <RenameElementModal />
      <TableSeatingModal />
    </div>
  );
};
