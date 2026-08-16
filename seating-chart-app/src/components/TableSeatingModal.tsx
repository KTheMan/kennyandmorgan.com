import React, { useMemo } from "react";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import {
  tableSeatingModalStateAtom,
  baseShapesAtom,
  guestsAtom,
} from "../lib/atoms";
import { Table } from "../types/seatingChart";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Minus, Plus, LayoutGrid, Rows3, Link2, Unlink2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { Switch } from "@/components/ui/switch";
import {
  compactGuestsAfterSeatRemoval,
  findSeatToRemove,
} from "@/lib/seatRemoval";
import {
  compactGuestsAfterSeatRemovals,
  findButtedTableEdge,
  getChairIndexesOnEdge,
  getLinkedTableComponent,
  getOccupiedGuestsOnEdge,
  getTableLinkAlignmentDelta,
  restoreGuestsAfterSeatInsertions,
  restoredCapacityAfterUnlink,
  TABLE_EDGES,
} from "@/lib/tableLinks";

const MIN_SIDE_SEATS = 0;
const MAX_SIDE_SEATS = 8;

export const TableSeatingModal: React.FC = () => {
  const [modalState, setModalState] = useAtom(tableSeatingModalStateAtom);
  const setBaseShapes = useSetAtom(baseShapesAtom);
  const setGuests = useSetAtom(guestsAtom);
  const store = useStore();
  const baseShapes = useAtomValue(baseShapesAtom);
  const { toast } = useToast();

  const table = useMemo(() => {
    const shape = baseShapes.find((s) => s.id === modalState.tableId);
    return shape && shape.type === "table" ? (shape as Table) : null;
  }, [baseShapes, modalState.tableId]);
  const tables = useMemo(
    () => baseShapes.filter((shape): shape is Table => shape.type === "table"),
    [baseShapes],
  );
  const linkedTables = useMemo(
    () => (table ? getLinkedTableComponent(tables, table.id) : []),
    [table, tables],
  );

  const handleClose = () => {
    setModalState({ isOpen: false, tableId: null });
  };

  const updateTable = (updates: Partial<Table>) => {
    if (!table) return;
    setBaseShapes((prevShapes) =>
      prevShapes.map((s) =>
        s.type === "table" && s.id === table.id ? { ...s, ...updates } : s,
      ),
    );
  };

  const handleLinkTouchingTable = () => {
    if (!table) return;
    const candidate = findButtedTableEdge(table, tables);
    if (!candidate) {
      toast({
        title: "No Touching Edge Found",
        description: "Move this rectangular table edge against another rectangular table, then try again.",
        variant: "destructive",
      });
      return;
    }

    const other = tables.find((item) => item.id === candidate.otherTableId);
    if (!other) return;
    const alignmentDelta = getTableLinkAlignmentDelta(candidate, tables);
    if (!alignmentDelta) return;
    const currentGuests = store.get(guestsAtom);
    const blocked = [
      ...getOccupiedGuestsOnEdge(table, candidate.edge, currentGuests),
      ...getOccupiedGuestsOnEdge(other, candidate.otherEdge, currentGuests),
    ];
    if (blocked.length > 0) {
      toast({
        title: "Shared Edge Is Occupied",
        description: `Move ${blocked.map((guest) => guest.fullName).join(", ")} off the joining edge first.`,
        variant: "destructive",
      });
      return;
    }

    const removedFromTable = getChairIndexesOnEdge(table, candidate.edge);
    const removedFromOther = getChairIndexesOnEdge(other, candidate.otherEdge);
    setGuests((prev) =>
      compactGuestsAfterSeatRemovals(
        compactGuestsAfterSeatRemovals(prev, table.id, removedFromTable),
        other.id,
        removedFromOther,
      ),
    );

    const affectedIds = new Set([
      ...getLinkedTableComponent(tables, table.id).map((item) => item.id),
      ...getLinkedTableComponent(tables, other.id).map((item) => item.id),
    ]);
    const otherComponentIds = new Set(
      getLinkedTableComponent(tables, other.id).map((item) => item.id),
    );
    setBaseShapes((prev) =>
      prev.map((shape) => {
        if (shape.type !== "table") return shape;
        const alignedPosition = otherComponentIds.has(shape.id)
          ? {
              x: shape.x + alignmentDelta.x,
              y: shape.y + alignmentDelta.y,
            }
          : {};
        const mergedReset = affectedIds.has(shape.id)
          ? { linkedSeatingMerged: false }
          : {};
        if (shape.id === table.id) {
          return {
            ...shape,
            ...alignedPosition,
            ...mergedReset,
            capacity: shape.capacity - removedFromTable.length,
            topSeats:
              shape.seatingStyle === "opposing" && candidate.edge === "top"
                ? 0
                : shape.topSeats,
            bottomSeats:
              shape.seatingStyle === "opposing" && candidate.edge === "bottom"
                ? 0
                : shape.bottomSeats,
            linkedEdges: {
              ...shape.linkedEdges,
              [candidate.edge]: {
                tableId: other.id,
                edge: candidate.otherEdge,
                removedSeats: removedFromTable.length,
                removedSeatIndexes: removedFromTable,
              },
            },
          };
        }
        if (shape.id === other.id) {
          return {
            ...shape,
            ...alignedPosition,
            ...mergedReset,
            capacity: shape.capacity - removedFromOther.length,
            topSeats:
              shape.seatingStyle === "opposing" && candidate.otherEdge === "top"
                ? 0
                : shape.topSeats,
            bottomSeats:
              shape.seatingStyle === "opposing" && candidate.otherEdge === "bottom"
                ? 0
                : shape.bottomSeats,
            linkedEdges: {
              ...shape.linkedEdges,
              [candidate.otherEdge]: {
                tableId: table.id,
                edge: candidate.edge,
                removedSeats: removedFromOther.length,
                removedSeatIndexes: removedFromOther,
              },
            },
          };
        }
        return affectedIds.has(shape.id)
          ? { ...shape, ...alignedPosition, ...mergedReset }
          : shape;
      }),
    );
    toast({
      title: "Tables Linked",
      description: "The edges were snapped together, shared seats removed, and the tables now move together.",
    });
  };

  const handleUnlinkEdge = (edge: (typeof TABLE_EDGES)[number]) => {
    if (!table) return;
    const link = table.linkedEdges?.[edge];
    if (!link) return;
    const other = tables.find((item) => item.id === link.tableId);
    const reciprocal = other?.linkedEdges?.[link.edge];
    setGuests((prev) =>
      restoreGuestsAfterSeatInsertions(
        restoreGuestsAfterSeatInsertions(
          prev,
          table.id,
          link.removedSeatIndexes ?? [],
        ),
        link.tableId,
        reciprocal?.removedSeatIndexes ?? [],
      ),
    );
    const componentIds = new Set(linkedTables.map((item) => item.id));
    setBaseShapes((prev) =>
      prev.map((shape) => {
        if (shape.type !== "table") return shape;
        if (shape.id !== table.id && shape.id !== link.tableId) {
          return componentIds.has(shape.id)
            ? { ...shape, linkedSeatingMerged: false }
            : shape;
        }
        const ownEdge = shape.id === table.id ? edge : link.edge;
        const linkedEdges = { ...shape.linkedEdges };
        delete linkedEdges[ownEdge];
        return {
          ...shape,
          ...restoredCapacityAfterUnlink(shape, ownEdge),
          linkedEdges,
          linkedSeatingMerged: false,
        };
      }),
    );
  };

  const handleMergedSeatingChange = (merged: boolean) => {
    const ids = new Set(linkedTables.map((item) => item.id));
    setBaseShapes((prev) =>
      prev.map((shape) =>
        shape.type === "table" && ids.has(shape.id)
          ? { ...shape, linkedSeatingMerged: merged }
          : shape,
      ),
    );
  };

  const handleStyleChange = (style: "all" | "opposing") => {
    if (!table || table.seatingStyle === style) return;
    if (linkedTables.length > 1) {
      toast({
        title: "Unlink To Change Layout",
        description: "The joined edges use the current seat layout. Unlink this set before switching styles.",
        variant: "destructive",
      });
      return;
    }

    if (style === "opposing") {
      const top = table.topSeats ?? Math.ceil(table.capacity / 2);
      const bottom = table.bottomSeats ?? Math.floor(table.capacity / 2);
      updateTable({ seatingStyle: "opposing", topSeats: top, bottomSeats: bottom, capacity: top + bottom });
    } else {
      updateTable({ seatingStyle: "all" });
    }
  };

  const handleSideChange = (side: "top" | "bottom", delta: number) => {
    if (!table) return;
    if (table.linkedEdges?.[side]) return;
    const top = table.topSeats ?? Math.ceil(table.capacity / 2);
    const bottom = table.bottomSeats ?? Math.floor(table.capacity / 2);
    const nextTop = side === "top" ? top + delta : top;
    const nextBottom = side === "bottom" ? bottom + delta : bottom;

    if (nextTop < MIN_SIDE_SEATS || nextTop > MAX_SIDE_SEATS) return;
    if (nextBottom < MIN_SIDE_SEATS || nextBottom > MAX_SIDE_SEATS) return;

    if (delta < 0) {
      const sideStart = side === "top" ? 0 : top;
      const sideEnd = side === "top" ? top : top + bottom;
      const removedChairIndex = findSeatToRemove(
        store.get(guestsAtom),
        table.id,
        sideStart,
        sideEnd,
      );
      if (removedChairIndex === null) {
        toast({
          title: "Cannot Reduce Seats",
          description: `Every seat on the ${side} side is occupied. Remove a guest first.`,
          variant: "destructive",
        });
        return;
      }

      setGuests((prev) =>
        compactGuestsAfterSeatRemoval(prev, table.id, removedChairIndex),
      );
    }

    updateTable({ topSeats: nextTop, bottomSeats: nextBottom, capacity: nextTop + nextBottom });
  };

  if (!table) {
    return (
      <Dialog open={modalState.isOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[420px]" />
      </Dialog>
    );
  }

  const isOpposing = table.seatingStyle === "opposing";
  const topSeats = table.topSeats ?? Math.ceil(table.capacity / 2);
  const bottomSeats = table.bottomSeats ?? Math.floor(table.capacity / 2);

  return (
    <Dialog open={modalState.isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Table {table.number} Seating Layout</DialogTitle>
          <DialogDescription>
            Choose how seats are arranged around this table.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={!isOpposing ? "default" : "outline"}
              className="h-auto flex-col gap-1.5 py-3"
              onClick={() => handleStyleChange("all")}
              disabled={linkedTables.length > 1}
            >
              <LayoutGrid size={18} strokeWidth={1.5} />
              <span className="text-sm font-medium">All Sides</span>
            </Button>
            <Button
              type="button"
              variant={isOpposing ? "default" : "outline"}
              className="h-auto flex-col gap-1.5 py-3"
              onClick={() => handleStyleChange("opposing")}
              disabled={linkedTables.length > 1}
            >
              <Rows3 size={18} strokeWidth={1.5} />
              <span className="text-sm font-medium">Opposing Sides Only</span>
            </Button>
          </div>

          {isOpposing ? (
            <div className="grid gap-3 rounded-md border border-border p-4">
              <p className="text-xs text-muted-foreground">
                Seats sit only on the top and bottom edges. The two sides
                don't need to match — set each independently.
              </p>
              <SideStepper
                label="Top side"
                value={topSeats}
                onDecrease={() => handleSideChange("top", -1)}
                onIncrease={() => handleSideChange("top", 1)}
                disableDecrease={topSeats <= MIN_SIDE_SEATS || Boolean(table.linkedEdges?.top)}
                disableIncrease={topSeats >= MAX_SIDE_SEATS || Boolean(table.linkedEdges?.top)}
              />
              <SideStepper
                label="Bottom side"
                value={bottomSeats}
                onDecrease={() => handleSideChange("bottom", -1)}
                onIncrease={() => handleSideChange("bottom", 1)}
                disableDecrease={bottomSeats <= MIN_SIDE_SEATS || Boolean(table.linkedEdges?.bottom)}
                disableIncrease={bottomSeats >= MAX_SIDE_SEATS || Boolean(table.linkedEdges?.bottom)}
              />
              <p className="text-sm font-medium text-foreground">
                {topSeats + bottomSeats} seats total
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Seats are spread across all four sides, proportional to each
              side's length. Use the +/- buttons on the table itself to
              change the total seat count.
            </p>
          )}

          {table.shape === "rectangle" && (
            <div className="grid gap-3 rounded-md border border-border p-4">
              <div>
                <p className="text-sm font-medium text-foreground">Linked tables</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Butt two rectangular edges together, then link them. Empty seats on the shared edge are removed; occupied edges are blocked.
                </p>
              </div>
              <Button type="button" variant="outline" onClick={handleLinkTouchingTable}>
                <Link2 size={16} className="mr-2" />
                Link touching edge
              </Button>
              {TABLE_EDGES.filter((edge) => table.linkedEdges?.[edge]).map((edge) => {
                const link = table.linkedEdges![edge]!;
                const other = tables.find((item) => item.id === link.tableId);
                return (
                  <div key={edge} className="flex items-center justify-between gap-3 text-sm">
                    <span className="capitalize text-muted-foreground">
                      {edge} edge → Table {other?.number ?? "?"}
                    </span>
                    <Button type="button" size="sm" variant="ghost" onClick={() => handleUnlinkEdge(edge)}>
                      <Unlink2 size={14} className="mr-1.5" />
                      Unlink
                    </Button>
                  </div>
                );
              })}
              {linkedTables.length > 1 && (
                <div className="flex items-center justify-between gap-4 border-t border-border pt-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Merge for seating</p>
                    <p className="text-xs text-muted-foreground">
                      Show this linked set as one combined table in the guest list.
                    </p>
                  </div>
                  <Switch
                    checked={linkedTables.some((item) => item.linkedSeatingMerged)}
                    onCheckedChange={handleMergedSeatingChange}
                    aria-label="Merge linked tables for seating"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" onClick={handleClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const SideStepper: React.FC<{
  label: string;
  value: number;
  onDecrease: () => void;
  onIncrease: () => void;
  disableDecrease: boolean;
  disableIncrease: boolean;
}> = ({ label, value, onDecrease, onIncrease, disableDecrease, disableIncrease }) => (
  <div className="flex items-center justify-between">
    <span className="text-sm font-medium text-foreground">{label}</span>
    <div className="flex items-center gap-3">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-7 w-7"
        onClick={onDecrease}
        disabled={disableDecrease}
      >
        <Minus size={14} />
      </Button>
      <span className="w-6 text-center text-sm font-semibold tabular-nums">
        {value}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-7 w-7"
        onClick={onIncrease}
        disabled={disableIncrease}
      >
        <Plus size={14} />
      </Button>
    </div>
  </div>
);
