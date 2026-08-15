import React, { useEffect, useMemo, useState, useCallback } from "react";
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
import { Table, VenueElement } from "../types/seatingChart";
import { GuestAssignmentModal } from "./GuestAssignmentModal";
import { RenameElementModal } from "./RenameElementModal";
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

  const { isLoading, isSaving, serverError, updateError } = useVenuePersistence(
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
      <div className="flex flex-1 overflow-hidden">
        {isDesktop ? (
          <Sidebar
            guests={guestsValue}
            tables={baseShapesValue.filter(
              (s): s is Table => s.type === "table",
            )}
            isAdmin={isAdmin}
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
              />
            </SheetContent>
          </Sheet>
        )}
        <div className="flex-1 flex flex-col p-4 md:p-5 border-l border-border/40 bg-background/50">
          <div
            className="flex-1 relative rounded-lg border border-border/40 shadow-md overflow-hidden"
            tabIndex={1}
          >
            <SortedCanvasStageAdapter shapeAtoms={shapeAtoms} />
          </div>
        </div>
      </div>
      <GuestAssignmentModal />
      <RenameElementModal />
    </div>
  );
};
