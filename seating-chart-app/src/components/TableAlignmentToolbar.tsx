import React, { useMemo } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  MoveVertical,
  X,
  type LucideIcon,
} from "lucide-react";
import { baseShapesAtom, selectedTableIdsAtom } from "@/lib/atoms";
import type { Table } from "@/types/seatingChart";
import {
  alignSelectedTableUnits,
  getSelectedTableUnits,
  type TableAlignment,
} from "@/lib/tableAlignment";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const TOOLS: Array<{
  alignment: TableAlignment;
  label: string;
  icon: LucideIcon;
}> = [
  { alignment: "left", label: "Align left edges", icon: AlignLeft },
  { alignment: "centerX", label: "Align horizontal centers", icon: AlignCenter },
  { alignment: "right", label: "Align right edges", icon: AlignRight },
  { alignment: "top", label: "Align top edges", icon: ArrowUpToLine },
  { alignment: "centerY", label: "Align vertical centers", icon: MoveVertical },
  { alignment: "bottom", label: "Align bottom edges", icon: ArrowDownToLine },
];

export const TableAlignmentToolbar: React.FC = () => {
  const shapes = useAtomValue(baseShapesAtom);
  const selectedIds = useAtomValue(selectedTableIdsAtom);
  const setShapes = useSetAtom(baseShapesAtom);
  const setSelectedIds = useSetAtom(selectedTableIdsAtom);
  const tables = useMemo(
    () => shapes.filter((shape): shape is Table => shape.type === "table"),
    [shapes],
  );
  const units = useMemo(
    () => getSelectedTableUnits(tables, selectedIds),
    [selectedIds, tables],
  );
  if (units.length < 2) return null;

  const isLocked = units.some((unit) =>
    unit.tables.some((table) => table.locked === true),
  );
  const align = (alignment: TableAlignment) => {
    if (isLocked) return;
    setShapes((current) => {
      const currentTables = current.filter(
        (shape): shape is Table => shape.type === "table",
      );
      const aligned = new Map(
        alignSelectedTableUnits(currentTables, selectedIds, alignment).map(
          (table) => [table.id, table],
        ),
      );
      return current.map((shape) => aligned.get(shape.id) ?? shape);
    });
  };

  return (
    <div className="absolute left-1/2 top-3 z-30 flex max-w-[calc(100%-7rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-lg border border-border/60 bg-card/95 p-1.5 shadow-lg backdrop-blur-sm">
      <span className="hidden whitespace-nowrap px-2 text-xs font-medium text-muted-foreground xl:inline">
        {selectedIds.size} tables
      </span>
      <TooltipProvider delayDuration={200}>
        {TOOLS.map(({ alignment, label, icon: Icon }, index) => (
          <React.Fragment key={alignment}>
            {index === 3 && <div className="mx-1 h-6 w-px bg-border" />}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => align(alignment)}
                  disabled={isLocked}
                  aria-label={label}
                >
                  <Icon size={16} strokeWidth={1.75} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{isLocked ? "Unlock every selected table to align" : label}</p>
              </TooltipContent>
            </Tooltip>
          </React.Fragment>
        ))}
        <div className="mx-1 h-6 w-px bg-border" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                setSelectedIds(new Set());
              }}
              aria-label="Clear table selection"
            >
              <X size={16} strokeWidth={1.75} />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>Clear selection</p></TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
};
