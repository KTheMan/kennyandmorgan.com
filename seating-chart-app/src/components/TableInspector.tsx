import React, { useId } from "react";
import {
  Copy,
  LayoutGrid,
  Lock,
  Minus,
  Pencil,
  Plus,
  Trash2,
  Unlock,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { Table } from "@/types/seatingChart";

export interface TableInspectorProps {
  /** The single table currently serving as the primary selection. */
  table: Table;
  /** Number of guests currently assigned to this physical table. */
  occupiedSeats: number;
  /** Clears the current table selection and closes the inspector. */
  onClearSelection: () => void;
  /** Opens the rectangular-table seating-layout editor. */
  onOpenSeatingLayout: () => void;
  /** Opens the parent-owned flow for changing this table's identity. */
  onRename: () => void;
  /** Capacity mutations remain parent-owned so occupied-seat safeguards stay centralized. */
  onDecreaseCapacity: () => void;
  onIncreaseCapacity: () => void;
  canDecreaseCapacity: boolean;
  canIncreaseCapacity: boolean;
  onDuplicate: () => void;
  onTogglePositionLock: () => void;
  /** Opens the parent-owned confirmation/safe deletion flow. */
  onDelete: () => void;
  className?: string;
}

/**
 * A DOM-based, keyboard-accessible alternative to the transient controls
 * painted inside a selected Konva table. All mutations are intentionally
 * supplied by the parent so this component never duplicates seating, link,
 * capacity, or deletion invariants.
 */
export const TableInspector: React.FC<TableInspectorProps> = ({
  table,
  occupiedSeats,
  onClearSelection,
  onOpenSeatingLayout,
  onRename,
  onDecreaseCapacity,
  onIncreaseCapacity,
  canDecreaseCapacity,
  canIncreaseCapacity,
  onDuplicate,
  onTogglePositionLock,
  onDelete,
  className,
}) => {
  const titleId = useId();
  const capacityId = useId();
  const isRectangle = table.shape === "rectangle";
  const usesOpposingSides =
    isRectangle && table.seatingStyle === "opposing";
  const shapeLabel = isRectangle ? "Rectangular table" : "Round table";
  const layoutLabel = usesOpposingSides ? "Opposing sides" : "All sides";

  return (
    <aside
      aria-labelledby={titleId}
      className={cn(
        "w-full max-w-sm rounded-xl border border-border bg-background/95 p-4 shadow-lg backdrop-blur-sm",
        className,
      )}
      data-table-inspector
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Selected table
          </p>
          <h2
            id={titleId}
            className="mt-0.5 truncate text-lg font-semibold text-foreground"
          >
            Table {table.number}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {shapeLabel}
            {isRectangle ? ` · ${layoutLabel}` : ""}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0"
          onClick={onClearSelection}
          aria-label={`Clear selection for Table ${table.number}`}
        >
          <X aria-hidden="true" />
        </Button>
      </div>

      <Separator className="my-4" />

      <div aria-labelledby={capacityId}>
        <div className="flex items-baseline justify-between gap-4">
          <h3 id={capacityId} className="text-sm font-medium text-foreground">
            Capacity
          </h3>
          <output
            className="text-sm font-semibold tabular-nums text-foreground"
            aria-live="polite"
            aria-atomic="true"
          >
            {occupiedSeats} of {table.capacity} seats filled
          </output>
        </div>

        {usesOpposingSides ? (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Adjust the top and bottom seat counts in Seating layout.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-10"
              onClick={onDecreaseCapacity}
              disabled={!canDecreaseCapacity}
              aria-describedby={capacityId}
            >
              <Minus aria-hidden="true" />
              Remove seat
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-10"
              onClick={onIncreaseCapacity}
              disabled={!canIncreaseCapacity}
              aria-describedby={capacityId}
            >
              <Plus aria-hidden="true" />
              Add seat
            </Button>
          </div>
        )}
      </div>

      <Separator className="my-4" />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-1" aria-label="Table actions">
        {isRectangle && (
          <Button
            type="button"
            variant="outline"
            className="h-10 justify-start"
            onClick={onOpenSeatingLayout}
          >
            <LayoutGrid aria-hidden="true" />
            Seating layout
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="h-10 justify-start"
          onClick={onRename}
        >
          <Pencil aria-hidden="true" />
          Rename table
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 justify-start"
          onClick={onDuplicate}
        >
          <Copy aria-hidden="true" />
          Duplicate table
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 justify-start"
          onClick={onTogglePositionLock}
          aria-pressed={table.locked === true}
        >
          {table.locked ? (
            <Unlock aria-hidden="true" />
          ) : (
            <Lock aria-hidden="true" />
          )}
          {table.locked ? "Unlock position" : "Lock position"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="col-span-2 h-10 justify-start border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive sm:col-span-1"
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" />
          Delete table
        </Button>
      </div>
    </aside>
  );
};
