import { atom, type PrimitiveAtom } from "jotai";
import { splitAtom } from "jotai/utils";
import { Table, VenueElement, Guest, BackgroundImage } from "../types/seatingChart";
import type { VenueData } from "@shared/types/venue";
import type { VenueVersion } from "@shared/types/venue";

// Define Shape union type and export it
export type Shape = VenueElement | Table | BackgroundImage;

// --- Standard Atoms (No Longer Persisted Automatically) ---

// Base atom to store all shapes (venue elements and tables)
const baseShapesAtom = atom<Shape[]>([]);
export { baseShapesAtom };

// Atom containing derived atoms for each shape
export const shapeAtomsAtom = splitAtom(baseShapesAtom);

// Atom to store the currently selected shape ID
export const selectedShapeIdAtom = atom(null) as PrimitiveAtom<string | null>;

// Table-only multi-selection. Kept separate from selectedShapeIdAtom so
// existing single-shape editing (venue elements, background, transformer)
// stays intact while Ctrl/Cmd-click can build a table selection set.
export const selectedTableIdsAtom = atom<Set<string>>(new Set<string>());

// Atom to store the currently hovered guest ID
export const hoveredGuestIdAtom = atom(null) as PrimitiveAtom<string | null>;

// Atom to store the currently hovered table ID
export const hoveredTableIdAtom = atom(null) as PrimitiveAtom<string | null>;

// Atom to store which seat (table + chair index) is currently under direct
// pointer hover — separate from hoveredGuestIdAtom, which also lights up
// from the sidebar guest list and doesn't carry a chair index, and which
// stays null for hovering an empty seat. The top-level seat-name tooltip
// (see SeatTooltipLayer) reads this to know which chair's name tag to
// draw; it's rendered in its own Layer, above every table, specifically so
// a neighboring table can never paint over it.
export const hoveredSeatAtom = atom(null) as PrimitiveAtom<{
  tableId: string;
  chairIndex: number;
} | null>;

// Atom to store the dragging state
export const isDraggingAtom = atom<boolean>(false);

// Atom to store the panning state
export const isPanningAtom = atom<boolean>(false);

// Atom to store the stage scale
export const stageScaleAtom = atom<number>(1);

// One-shot request used by sidebar search results to bring a table into the
// visible canvas viewport. The monotonically increasing requestId means the
// same table can be focused again after the user pans away.
export const tableFocusRequestAtom = atom(null) as PrimitiveAtom<{
  tableId: string;
  requestId: number;
} | null>;

// Persistent, user-named chart milestones. These are intentionally separate
// from the live editing state so restoring one never erases the other saved
// configurations.
export const venueVersionsAtom = atom<VenueVersion[]>([]);
export const venueVersionBackgroundAssetsAtom = atom<Record<string, string>>({});

// Atom to track if the venue space shape is locked
export const venueSpaceLockedAtom = atom<boolean>(false);

// Atom to store all guests
export const guestsAtom = atom<Guest[]>([]);

// Build the chair lookup once per guest-list change. Previously every table
// scanned the entire guest list to build its own map, turning one assignment
// into O(tables * guests) work before any chairs were even rendered.
export const guestSeatsByTableAtom = atom((get) => {
  const seatsByTable = new Map<string, Map<number, string>>();

  for (const guest of get(guestsAtom)) {
    if (!guest.tableId || typeof guest.chairIndex !== "number") continue;

    let tableSeats = seatsByTable.get(guest.tableId);
    if (!tableSeats) {
      tableSeats = new Map<number, string>();
      seatsByTable.set(guest.tableId, tableSeats);
    }
    tableSeats.set(guest.chairIndex, guest.id);
  }

  return seatsByTable;
});

// Atom to calculate the total number of guests
export const totalGuestsAtom = atom((get) => get(guestsAtom).length);

// Atom containing derived atoms for each guest
export const guestAtomsAtom = splitAtom(guestsAtom);

// Atom to keep track of the next table number
export const tableCounterAtom = atom<number>(1);

// Atom to store the event title
export const eventTitleAtom = atom<string>("Kenny & Morgan's Wedding");

// Whether the current visitor can edit this venue: true for the site
// admin, and for anyone who's unlocked this venue's PIN. Set once by
// SeatingChartApp from VenueGate's access resolution; components read it
// as a guard (disable inputs, block add/remove actions) rather than
// setting it themselves.
export const editModeAtom = atom<boolean>(false);

// --- Transient Atoms (Not persisted) ---

// Atom to manage the state of the guest assignment modal
export const modalStateAtom = atom<{
  isOpen: boolean;
  chairId: string | null;
  guestId: string | null;
}>({ isOpen: false, chairId: null, guestId: null });

// Atom for the rename element modal state
export const renameModalStateAtom = atom<{
  isOpen: boolean;
  elementId: string | null;
  currentTitle: string | null;
}>({ isOpen: false, elementId: null, currentTitle: null });

// Atom for the rectangle-table seating layout modal state (all sides vs.
// opposing sides only, with independent per-side seat counts)
export const tableSeatingModalStateAtom = atom<{
  isOpen: boolean;
  tableId: string | null;
}>({ isOpen: false, tableId: null });

// Live preview while dragging a whole party (group) over the canvas — the
// chairIndexes it would land in if dropped right now, in guest order.
// Purely transient UI state, not persisted; cleared as soon as the drag
// ends or moves off that table. Single-guest drags don't use this — only
// group drags get the "show where each seat would go" preview.
export const groupDropPreviewAtom = atom(null) as PrimitiveAtom<{
  tableId: string;
  chairIndexes: number[];
} | null>;

// --- Derived Atoms ---

// Derived atom that combines all relevant state into a single VenueData object
// This will be watched by the persistence logic
export const venueDataAtom = atom<VenueData>(
  (get) => ({
    shapes: get(baseShapesAtom),
    guests: get(guestsAtom),
    eventTitle: get(eventTitleAtom),
    tableCounter: get(tableCounterAtom),
    versions: get(venueVersionsAtom),
    versionBackgroundAssets: get(venueVersionBackgroundAssetsAtom),
  }),
);

// Atom for only Venue Space elements (should typically be just one)
export const venueSpaceShapeAtomsAtom = atom((get) =>
  get(shapeAtomsAtom).filter((shapeAtom) => {
    const shape = get(shapeAtom);
    return shape.type === "venue" && shape.title === "Venue Space";
  }),
);

// Atom for all other shapes (non-Venue Space)
export const otherShapeAtomsAtom = atom((get) =>
  get(shapeAtomsAtom).filter((shapeAtom) => {
    const shape = get(shapeAtom);
    // Include tables and venue elements that are NOT title 'Venue Space'
    return (
      shape.type === "table" ||
      (shape.type === "venue" && shape.title !== "Venue Space")
    );
  }),
);
