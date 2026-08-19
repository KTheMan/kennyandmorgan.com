import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";

import {
  baseShapesAtom,
  editModeAtom,
  eventTitleAtom,
  guestsAtom,
  selectedShapeIdAtom,
  selectedTableIdsAtom,
  tableCounterAtom,
  venueDataAtom,
} from "@/lib/atoms";
import type { VenueData, VenueSnapshotData } from "@shared/types/venue";

const HISTORY_LIMIT = 30;
const SETTLE_DELAY_MS = 250;

const snapshotFromVenue = (venue: VenueData): VenueSnapshotData => ({
  shapes: venue.shapes,
  guests: venue.guests,
  eventTitle: venue.eventTitle,
  tableCounter: venue.tableCounter,
});

const sameSnapshot = (left: VenueSnapshotData, right: VenueSnapshotData) =>
  left.shapes === right.shapes &&
  left.guests === right.guests &&
  left.eventTitle === right.eventTitle &&
  left.tableCounter === right.tableCounter;

const isTextEditingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable ||
    target.getAttribute("role") === "textbox"
  );
};

export const useVenueHistory = (slug: string, loadRevision: number) => {
  const venueData = useAtomValue(venueDataAtom);
  const editMode = useAtomValue(editModeAtom);
  const setShapes = useSetAtom(baseShapesAtom);
  const setGuests = useSetAtom(guestsAtom);
  const setEventTitle = useSetAtom(eventTitleAtom);
  const setTableCounter = useSetAtom(tableCounterAtom);
  const setSelectedShapeId = useSetAtom(selectedShapeIdAtom);
  const setSelectedTableIds = useSetAtom(selectedTableIdsAtom);

  const liveSnapshot = useMemo(() => snapshotFromVenue(venueData), [venueData]);
  const liveSnapshotRef = useRef(liveSnapshot);
  liveSnapshotRef.current = liveSnapshot;

  const currentRef = useRef(liveSnapshot);
  const pastRef = useRef<VenueSnapshotData[]>([]);
  const futureRef = useRef<VenueSnapshotData[]>([]);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressedSnapshotRef = useRef<VenueSnapshotData | null>(null);
  const resetIdentityRef = useRef(`${slug}:${loadRevision}`);
  const [, render] = useState(0);

  const refreshControls = useCallback(() => render((revision) => revision + 1), []);

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  const applySnapshot = useCallback((snapshot: VenueSnapshotData) => {
    suppressedSnapshotRef.current = snapshot;
    setShapes(snapshot.shapes);
    setGuests(snapshot.guests);
    setEventTitle(snapshot.eventTitle);
    setTableCounter(snapshot.tableCounter);
    setSelectedTableIds(new Set());
    setSelectedShapeId(null);
  }, [
    setEventTitle,
    setGuests,
    setSelectedShapeId,
    setSelectedTableIds,
    setShapes,
    setTableCounter,
  ]);

  const commitLiveSnapshot = useCallback(() => {
    clearSettleTimer();
    const live = liveSnapshotRef.current;
    if (sameSnapshot(live, currentRef.current)) return;
    pastRef.current = [...pastRef.current, currentRef.current].slice(-HISTORY_LIMIT);
    currentRef.current = live;
    futureRef.current = [];
    refreshControls();
  }, [clearSettleTimer, refreshControls]);

  // Loading a venue (including replacing a warm cache with server truth) is
  // not an edit. It establishes a fresh history root.
  useEffect(() => {
    const identity = `${slug}:${loadRevision}`;
    if (resetIdentityRef.current === identity) return;
    resetIdentityRef.current = identity;
    clearSettleTimer();
    currentRef.current = liveSnapshotRef.current;
    pastRef.current = [];
    futureRef.current = [];
    suppressedSnapshotRef.current = null;
    refreshControls();
  }, [clearSettleTimer, loadRevision, refreshControls, slug]);

  // Coalesce pointer drags and multi-atom commands into one reversible edit.
  useEffect(() => {
    if (
      suppressedSnapshotRef.current &&
      sameSnapshot(suppressedSnapshotRef.current, liveSnapshot)
    ) {
      suppressedSnapshotRef.current = null;
      currentRef.current = liveSnapshot;
      return;
    }
    if (sameSnapshot(liveSnapshot, currentRef.current)) return;

    clearSettleTimer();
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      const settled = liveSnapshotRef.current;
      if (sameSnapshot(settled, currentRef.current)) return;
      pastRef.current = [...pastRef.current, currentRef.current].slice(-HISTORY_LIMIT);
      currentRef.current = settled;
      futureRef.current = [];
      refreshControls();
    }, SETTLE_DELAY_MS);

    return clearSettleTimer;
  }, [clearSettleTimer, liveSnapshot, refreshControls]);

  const undo = useCallback(() => {
    if (!editMode) return;
    commitLiveSnapshot();
    const target = pastRef.current.at(-1);
    if (!target) return;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [currentRef.current, ...futureRef.current].slice(0, HISTORY_LIMIT);
    currentRef.current = target;
    applySnapshot(target);
    refreshControls();
  }, [applySnapshot, commitLiveSnapshot, editMode, refreshControls]);

  const redo = useCallback(() => {
    if (!editMode) return;
    commitLiveSnapshot();
    const target = futureRef.current[0];
    if (!target) return;
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current, currentRef.current].slice(-HISTORY_LIMIT);
    currentRef.current = target;
    applySnapshot(target);
    refreshControls();
  }, [applySnapshot, commitLiveSnapshot, editMode, refreshControls]);

  const restoreSnapshot = useCallback((snapshot: VenueSnapshotData) => {
    if (!editMode) return;
    commitLiveSnapshot();
    if (sameSnapshot(snapshot, currentRef.current)) return;
    pastRef.current = [...pastRef.current, currentRef.current].slice(-HISTORY_LIMIT);
    futureRef.current = [];
    currentRef.current = snapshot;
    applySnapshot(snapshot);
    refreshControls();
  }, [applySnapshot, commitLiveSnapshot, editMode, refreshControls]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!editMode || isTextEditingTarget(event.target)) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editMode, redo, undo]);

  useEffect(() => clearSettleTimer, [clearSettleTimer]);

  return {
    undo,
    redo,
    restoreSnapshot,
    canUndo: editMode && pastRef.current.length > 0,
    canRedo: editMode && futureRef.current.length > 0,
    undoDepth: pastRef.current.length,
    redoDepth: futureRef.current.length,
    historyLimit: HISTORY_LIMIT,
    currentSnapshot: liveSnapshot,
  };
};
