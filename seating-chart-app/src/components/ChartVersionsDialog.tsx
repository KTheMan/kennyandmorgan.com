import { useEffect, useMemo, useState } from "react";
import { Clock3, History, RotateCcw, Save, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { VenueVersion } from "@shared/types/venue";

interface ChartVersionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versions: VenueVersion[];
  canEdit: boolean;
  historyLimit: number;
  onSaveVersion: (name: string) => boolean;
  onRestoreVersion: (version: VenueVersion) => void;
  onDeleteVersion: (version: VenueVersion) => void;
  deletedVersionName?: string;
  onUndoDeleteVersion: () => void;
}

const formatCreatedAt = (createdAt: string) => {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "Saved milestone";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

export const ChartVersionsDialog = ({
  open,
  onOpenChange,
  versions,
  canEdit,
  historyLimit,
  onSaveVersion,
  onRestoreVersion,
  onDeleteVersion,
  deletedVersionName,
  onUndoDeleteVersion,
}: ChartVersionsDialogProps) => {
  const suggestedName = useMemo(() => {
    const usedNames = new Set(versions.map((version) => version.name.toLowerCase()));
    let number = 1;
    while (usedNames.has(`v${number}`)) number += 1;
    return `v${number}`;
  }, [versions]);
  const [name, setName] = useState(suggestedName);
  const normalizedName = name.trim();
  const duplicateName = versions.some(
    (version) => version.name.toLowerCase() === normalizedName.toLowerCase(),
  );
  const validationMessage = duplicateName
    ? "A saved version already uses this name."
    : versions.length >= 25
      ? "Delete a saved version before adding another."
      : null;

  useEffect(() => {
    if (open) setName(suggestedName);
  }, [open, suggestedName]);

  const handleSave = () => {
    if (onSaveVersion(name.trim())) setName(suggestedName);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border/60 px-6 pb-4 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" aria-hidden="true" />
            Saved versions
          </DialogTitle>
          <DialogDescription>
            Save named configurations for major milestones. Restoring one remains undoable within the {historyLimit}-edit history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 overflow-hidden px-6 py-5">
          {canEdit && (
            <section className="rounded-lg border border-border/60 bg-muted/20 p-4" aria-labelledby="save-version-heading">
              <h3 id="save-version-heading" className="text-sm font-semibold">Save the current configuration</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Use a meaningful name such as “v1”, “Dinner layout”, or “Final guest assignments”.
              </p>
              <div className="mt-3 flex gap-2">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleSave();
                  }}
                  maxLength={60}
                  placeholder="Version name"
                  aria-label="Version name"
                  aria-invalid={Boolean(validationMessage)}
                  aria-describedby={validationMessage ? "version-name-error" : undefined}
                />
                <Button onClick={handleSave} disabled={!normalizedName || Boolean(validationMessage)} className="shrink-0">
                  <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                  Save version
                </Button>
              </div>
              {validationMessage && (
                <p id="version-name-error" className="mt-2 text-xs font-medium text-destructive">
                  {validationMessage}
                </p>
              )}
            </section>
          )}

          <section aria-labelledby="saved-configurations-heading">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 id="saved-configurations-heading" className="text-sm font-semibold">Configurations</h3>
              <span className="text-xs tabular-nums text-muted-foreground">{versions.length} saved</span>
            </div>
            {deletedVersionName && (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2" role="status">
                <p className="min-w-0 truncate text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{deletedVersionName}</span> was deleted.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0"
                  onClick={onUndoDeleteVersion}
                  aria-label={`Undo deleting ${deletedVersionName}`}
                >
                  Undo
                </Button>
              </div>
            )}
            {versions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-5 py-8 text-center">
                <Clock3 className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
                <p className="mt-2 text-sm font-medium">No milestones saved yet</p>
                <p className="mt-1 text-xs text-muted-foreground">Your live chart still saves automatically.</p>
              </div>
            ) : (
              <ScrollArea className="max-h-[38vh] pr-3">
                <ul className="space-y-2">
                  {versions.map((version) => {
                    const tables = version.data.shapes.filter((shape) => shape.type === "table").length;
                    const seated = version.data.guests.filter((guest) => Boolean(guest.tableId)).length;
                    return (
                      <li key={version.id} className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{version.name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            <span className="block w-44" data-version-created-at>
                              {formatCreatedAt(version.createdAt)}
                            </span>
                            <span className="mt-0.5 block">{tables} tables · {seated}/{version.data.guests.length} seated</span>
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onRestoreVersion(version)}
                          disabled={!canEdit}
                          aria-label={`Restore ${version.name}`}
                        >
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                          Restore
                        </Button>
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => onDeleteVersion(version)}
                            aria-label={`Delete ${version.name}`}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </ScrollArea>
            )}
          </section>
        </div>

        <DialogFooter className="border-t border-border/60 px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
