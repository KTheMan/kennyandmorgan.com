import React, { useMemo } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
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
import { Minus, Plus, LayoutGrid, Rows3 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

const MIN_SIDE_SEATS = 1;
const MAX_SIDE_SEATS = 8;

export const TableSeatingModal: React.FC = () => {
  const [modalState, setModalState] = useAtom(tableSeatingModalStateAtom);
  const setBaseShapes = useSetAtom(baseShapesAtom);
  const guests = useAtomValue(guestsAtom);
  const baseShapes = useAtomValue(baseShapesAtom);
  const { toast } = useToast();

  const table = useMemo(() => {
    const shape = baseShapes.find((s) => s.id === modalState.tableId);
    return shape && shape.type === "table" ? (shape as Table) : null;
  }, [baseShapes, modalState.tableId]);

  // The highest chairIndex currently holding a guest at this table — any
  // change (mode switch, side-count decrease) that would drop total
  // capacity below this is refused, same rule the on-canvas capacity
  // buttons already enforce, so a seated guest is never orphaned.
  const highestOccupiedChairIndex = useMemo(() => {
    if (!table) return -1;
    let highest = -1;
    guests.forEach((g) => {
      if (g.tableId === table.id && g.chairIndex > highest) {
        highest = g.chairIndex;
      }
    });
    return highest;
  }, [guests, table]);

  const handleClose = () => {
    setModalState({ isOpen: false, tableId: null });
  };

  const updateTable = (updates: Partial<Table>) => {
    if (!table) return;
    setBaseShapes((prevShapes) =>
      prevShapes.map((s) => (s.id === table.id ? { ...s, ...updates } : s)),
    );
  };

  const minimumRequiredCapacity = highestOccupiedChairIndex + 1;

  const handleStyleChange = (style: "all" | "opposing") => {
    if (!table || table.seatingStyle === style) return;

    if (style === "opposing") {
      const top = table.topSeats ?? Math.ceil(table.capacity / 2);
      const bottom = table.bottomSeats ?? Math.floor(table.capacity / 2);
      if (top + bottom < minimumRequiredCapacity) {
        toast({
          title: "Cannot Switch Layout",
          description: `This table has guests seated past seat ${minimumRequiredCapacity}. Remove them first, or they'll lose their seat.`,
          variant: "destructive",
        });
        return;
      }
      updateTable({ seatingStyle: "opposing", topSeats: top, bottomSeats: bottom, capacity: top + bottom });
    } else {
      updateTable({ seatingStyle: "all" });
    }
  };

  const handleSideChange = (side: "top" | "bottom", delta: number) => {
    if (!table) return;
    const top = table.topSeats ?? Math.ceil(table.capacity / 2);
    const bottom = table.bottomSeats ?? Math.floor(table.capacity / 2);
    const nextTop = side === "top" ? top + delta : top;
    const nextBottom = side === "bottom" ? bottom + delta : bottom;

    if (nextTop < MIN_SIDE_SEATS || nextTop > MAX_SIDE_SEATS) return;
    if (nextBottom < MIN_SIDE_SEATS || nextBottom > MAX_SIDE_SEATS) return;

    if (delta < 0 && nextTop + nextBottom < minimumRequiredCapacity) {
      toast({
        title: "Cannot Reduce Seats",
        description: `Please remove guests from seats ${minimumRequiredCapacity} to ${top + bottom} first.`,
        variant: "destructive",
      });
      return;
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
      <DialogContent className="sm:max-w-[420px]">
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
            >
              <LayoutGrid size={18} strokeWidth={1.5} />
              <span className="text-sm font-medium">All Sides</span>
            </Button>
            <Button
              type="button"
              variant={isOpposing ? "default" : "outline"}
              className="h-auto flex-col gap-1.5 py-3"
              onClick={() => handleStyleChange("opposing")}
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
                disableDecrease={topSeats <= MIN_SIDE_SEATS}
                disableIncrease={topSeats >= MAX_SIDE_SEATS}
              />
              <SideStepper
                label="Bottom side"
                value={bottomSeats}
                onDecrease={() => handleSideChange("bottom", -1)}
                onIncrease={() => handleSideChange("bottom", 1)}
                disableDecrease={bottomSeats <= MIN_SIDE_SEATS}
                disableIncrease={bottomSeats >= MAX_SIDE_SEATS}
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
