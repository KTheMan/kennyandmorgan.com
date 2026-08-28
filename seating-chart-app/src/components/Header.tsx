import {
  Moon,
  Sun,
  RotateCcw,
  Users,
  BookOpen,
  Lock,
  Unlock,
  Save,
  Check,
  Armchair,
  Utensils,
  Menu,
  X,
  ShieldCheck,
  ArrowLeft,
  Eye,
  KeyRound,
  Share2,
  ChevronDown,
  Circle,
  RectangleHorizontal,
  ImagePlus,
  Image as ImageIcon,
  Trash2,
  MoreHorizontal,
  Undo2,
  Redo2,
  History,
  FileSpreadsheet,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/ThemeProvider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAtom, useAtomValue } from "jotai";
import { eventTitleAtom, editModeAtom } from "@/lib/atoms";
import { useToast } from "@/components/ui/use-toast";
import { setEditPin as setVenueEditPin, setViewPin as setVenueViewPin } from "@/lib/api/venues";
import { tryVerifyAdminSession } from "@/lib/adminAuth";
import type { BackgroundImage } from "@/types/seatingChart";

export type SaveStatus = "saved" | "saving" | "unsaved";

interface HeaderProps {
  slug: string;
  isAdmin: boolean;
  hasEditPin: boolean;
  hasViewPin: boolean;
  viewPinRequired: boolean;
  onUnlockWithPin: (pin: string) => Promise<boolean>;
  onViewPinChanged: () => void;
  onBackToManager: () => void;
  totalGuests: number;
  assignedGuests: number;
  unassignedGuests: number;
  openSeats: number;
  onReset: () => void;
  onAddTable: (shape?: "round" | "rectangle") => void;
  onAddVenueElement: () => void;
  onAddVenueSpace: () => void;
  isVenueSpacePresent: boolean;
  isVenueSpaceLocked: boolean;
  onToggleVenueLock: () => void;
  saveStatus: SaveStatus;
  onToggleMobileSidebar: () => void;
  isMobileSidebarOpen: boolean;
  showMobileSidebarToggle?: boolean;
  backgroundImage: BackgroundImage | null;
  onUploadBackgroundImage: (file: File) => void;
  onSelectBackgroundImage: () => void;
  onToggleBackgroundLock: () => void;
  onSetBackgroundOpacity: (opacity: number) => void;
  onRemoveBackgroundImage: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoDepth: number;
  redoDepth: number;
  onUndo: () => void;
  onRedo: () => void;
  onOpenVersions: () => void;
  versionCount: number;
  onExportSpreadsheet: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  slug,
  isAdmin,
  hasEditPin,
  hasViewPin,
  viewPinRequired,
  onUnlockWithPin,
  onViewPinChanged,
  onBackToManager,
  totalGuests,
  assignedGuests,
  unassignedGuests,
  openSeats,
  onReset,
  onAddTable,
  onAddVenueElement,
  onAddVenueSpace,
  isVenueSpacePresent,
  isVenueSpaceLocked,
  onToggleVenueLock,
  saveStatus,
  onToggleMobileSidebar,
  isMobileSidebarOpen,
  showMobileSidebarToggle = true,
  backgroundImage,
  onUploadBackgroundImage,
  onSelectBackgroundImage,
  onToggleBackgroundLock,
  onSetBackgroundOpacity,
  onRemoveBackgroundImage,
  canUndo,
  canRedo,
  undoDepth,
  redoDepth,
  onUndo,
  onRedo,
  onOpenVersions,
  versionCount,
  onExportSpreadsheet,
}) => {
  const [eventTitle, setEventTitle] = useAtom(eventTitleAtom);
  const editMode = useAtomValue(editModeAtom);
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const backgroundFileInputRef = useRef<HTMLInputElement>(null);
  // Live drag position for the opacity slider — the atom (and thus the
  // full multi-MB venue payload, both the localStorage cache and the
  // debounced server save) only gets updated once the user releases the
  // slider, not on every intermediate tick.
  const [opacityDraft, setOpacityDraft] = useState<number | null>(null);

  const handleBackgroundFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (file) onUploadBackgroundImage(file);
  };

  const [pinEntry, setPinEntry] = useState("");
  const [isPinSubmitting, setIsPinSubmitting] = useState(false);
  const [isRegeneratingEditPin, setIsRegeneratingEditPin] = useState(false);
  const [isTogglingViewPin, setIsTogglingViewPin] = useState(false);
  const [isRegeneratingViewPin, setIsRegeneratingViewPin] = useState(false);

  // Update document title when eventTitle changes
  useEffect(() => {
    document.title = `${eventTitle} - Seating Chart`;
  }, [eventTitle]);

  const handlePinUnlock = async () => {
    if (pinEntry.length !== 4) {
      toast({
        title: "Invalid PIN Format",
        description: "PIN must be 4 digits.",
        variant: "destructive",
      });
      return;
    }
    setIsPinSubmitting(true);
    try {
      const ok = await onUnlockWithPin(pinEntry);
      if (ok) {
        toast({ title: "Editing Unlocked", description: "You can now edit the canvas." });
        setPinEntry("");
      } else {
        toast({
          title: "Incorrect PIN",
          description: "Double-check the PIN and try again.",
          variant: "destructive",
        });
      }
    } catch (error: unknown) {
      toast({
        title: "PIN Unlock Error",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
        variant: "destructive",
      });
    }
    setIsPinSubmitting(false);
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast({ title: "Link Copied", description: "Anyone with this link can view the chart." });
    } catch {
      toast({
        title: "Couldn't Copy Link",
        description: window.location.href,
      });
    }
  };

  const handleRegenerateEditPin = async () => {
    setIsRegeneratingEditPin(true);
    try {
      const adminSession = await tryVerifyAdminSession();
      if (!adminSession) {
        throw new Error("Admin session required.");
      }
      const newPin = await setVenueEditPin(slug, adminSession.token);
      toast({
        title: "New Edit PIN Generated",
        description: `Share PIN: ${newPin} — the previous PIN no longer works.`,
      });
    } catch (error: unknown) {
      toast({
        title: "Couldn't Regenerate PIN",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setIsRegeneratingEditPin(false);
    }
  };

  // Toggling this venue's view PIN on/off. Admin-only — see
  // seating_chart_set_view_pin. Turning it on generates a fresh PIN
  // every time (never silently reuses an old one).
  const handleToggleViewPin = async (checked: boolean) => {
    setIsTogglingViewPin(true);
    try {
      const adminSession = await tryVerifyAdminSession();
      if (!adminSession) {
        throw new Error("Admin session required.");
      }
      const newPin = await setVenueViewPin(slug, adminSession.token, checked);
      if (checked) {
        toast({
          title: "View PIN Enabled",
          description: `Share PIN: ${newPin} — anyone without it can no longer view this chart.`,
        });
      } else {
        toast({
          title: "View PIN Disabled",
          description: "Anyone with the link can view this chart again.",
        });
      }
      onViewPinChanged();
    } catch (error: unknown) {
      toast({
        title: "Couldn't Update View PIN",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setIsTogglingViewPin(false);
    }
  };

  const handleRegenerateViewPin = async () => {
    setIsRegeneratingViewPin(true);
    try {
      const adminSession = await tryVerifyAdminSession();
      if (!adminSession) {
        throw new Error("Admin session required.");
      }
      const newPin = await setVenueViewPin(slug, adminSession.token, true);
      toast({
        title: "New View PIN Generated",
        description: `Share PIN: ${newPin} — the previous PIN no longer works.`,
      });
      onViewPinChanged();
    } catch (error: unknown) {
      toast({
        title: "Couldn't Regenerate View PIN",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setIsRegeneratingViewPin(false);
    }
  };

  return (
    <header className="relative overflow-hidden border-b border-border/40 bg-gradient-to-r from-card to-card/95 px-3 py-2.5 shadow-sm sm:px-5">
      <div className="texture-elegant pointer-events-none absolute inset-0" />
      <TooltipProvider delayDuration={300}>
        <div className="relative z-10 flex min-w-0 flex-col gap-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {showMobileSidebarToggle && (
              <Button
                variant="outline"
                size="icon"
                onClick={onToggleMobileSidebar}
                className="h-9 w-9 shrink-0 border-accent/30 bg-accent/5 shadow-sm hover:border-accent/50 hover:bg-accent/15 lg:hidden"
                aria-label={isMobileSidebarOpen ? "Close guest sidebar" : "Open guest sidebar"}
              >
                {isMobileSidebarOpen ? <X size={18} /> : <Menu size={18} />}
              </Button>
            )}

            <div className="flex shrink-0 items-center gap-2 text-card-foreground">
              <Armchair className="hidden text-primary/80 sm:block" size={22} strokeWidth={1.5} />
              <h1 className="text-base font-semibold tracking-wide sm:text-lg">Seating Chart</h1>
            </div>

            <Input
              value={eventTitle}
              onChange={(event) => setEventTitle(event.target.value)}
              className="mx-2 hidden h-9 min-w-0 flex-1 bg-card/60 text-center text-base font-semibold md:block"
              placeholder="Enter Event Title"
              aria-label="Event Title"
              disabled={!editMode}
            />

            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      "flex h-9 items-center rounded-md border px-2 text-sm font-medium shadow-sm sm:px-3",
                      saveStatus === "saved" && "border-muted bg-muted/30 text-muted-foreground",
                      saveStatus === "saving" && "border-accent/40 bg-accent/40 text-accent-foreground",
                      saveStatus === "unsaved" && "border-secondary/30 bg-secondary/20 text-secondary-foreground",
                    )}
                    role="status"
                    aria-live="polite"
                    aria-label={saveStatus === "saved" ? "All changes saved" : saveStatus === "saving" ? "Saving changes" : "Unsaved changes"}
                  >
                    {saveStatus === "saved" ? (
                      <Check size={16} strokeWidth={2} />
                    ) : saveStatus === "saving" ? (
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    ) : (
                      <Save size={16} strokeWidth={1.5} />
                    )}
                    <span className="ml-1.5 hidden sm:inline">
                      {saveStatus === "saved" ? "Saved" : saveStatus === "saving" ? "Saving…" : "Unsaved"}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="border-border bg-card text-card-foreground">
                  <p>{saveStatus === "saved" ? "All changes saved" : saveStatus === "saving" ? "Saving changes…" : "Changes will be saved shortly"}</p>
                </TooltipContent>
              </Tooltip>

              {editMode && (
                <div className="flex items-center rounded-md border border-border/30 bg-card/70 shadow-sm" role="group" aria-label="Edit history">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-r-none"
                        onClick={onUndo}
                        disabled={!canUndo}
                        aria-label={`Undo last change${undoDepth ? `, ${undoDepth} available` : ""}`}
                      >
                        <Undo2 size={16} aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Undo · Ctrl+Z</TooltipContent>
                  </Tooltip>
                  <span className="h-5 w-px bg-border/60" aria-hidden="true" />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-l-none"
                        onClick={onRedo}
                        disabled={!canRedo}
                        aria-label={`Redo last change${redoDepth ? `, ${redoDepth} available` : ""}`}
                      >
                        <Redo2 size={16} aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Redo · Ctrl+Shift+Z</TooltipContent>
                  </Tooltip>
                </div>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0 border-accent/30 bg-accent/5 shadow-sm hover:border-accent/50 hover:bg-accent/15"
                    onClick={onOpenVersions}
                    aria-label={`Saved versions${versionCount ? `, ${versionCount} saved` : ""}`}
                  >
                    <History size={17} aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Saved versions</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 shrink-0 border-accent/30 bg-accent/5 px-2.5 shadow-sm hover:border-accent/50 hover:bg-accent/15 2xl:px-3"
                    onClick={onExportSpreadsheet}
                    disabled={assignedGuests === 0}
                    aria-label="Export seating spreadsheet"
                  >
                    <FileSpreadsheet size={17} aria-hidden="true" />
                    <span className="ml-2 hidden 2xl:inline">Spreadsheet</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {assignedGuests === 0
                    ? "Seat at least one guest to export"
                    : "Download seating spreadsheet"}
                </TooltipContent>
              </Tooltip>

              <div
                className="hidden h-9 items-center rounded-md border border-border/30 bg-card/80 px-3 text-sm font-medium text-foreground/90 shadow-sm md:flex"
                role="status"
                aria-label={`${totalGuests} guests total, ${assignedGuests} seated, ${unassignedGuests} unassigned, ${openSeats} open seats`}
              >
                <Users size={16} className="mr-1.5 text-primary/80" strokeWidth={1.5} />
                <span className="tabular-nums">{assignedGuests}</span>
                <span className="ml-1 text-muted-foreground">seated</span>
                <span className="mx-1.5 text-border">·</span>
                <span className="tabular-nums">{unassignedGuests}</span>
                <span className="ml-1 text-muted-foreground">unassigned</span>
                <span className="mx-1.5 hidden text-border xl:inline">·</span>
                <span className="hidden tabular-nums xl:inline">{openSeats}</span>
                <span className="ml-1 hidden text-muted-foreground xl:inline">open seats</span>
              </div>

              {!isAdmin && (
                <div className={cn(
                  "hidden h-9 items-center rounded-md border px-2.5 text-sm font-medium shadow-sm sm:flex",
                  editMode
                    ? "border-[#BFCB8A] bg-[#EEF3DC] text-[#2E3A1C]"
                    : "border-muted bg-muted/30 text-muted-foreground",
                )}>
                  {editMode ? <KeyRound size={15} className="mr-1.5" /> : <Eye size={15} className="mr-1.5" />}
                  {editMode ? "Editing" : "View only"}
                </div>
              )}

              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 shrink-0 border-accent/30 bg-accent/5 shadow-sm hover:border-accent/50 hover:bg-accent/15"
                        aria-label="Open chart menu"
                      >
                        <MoreHorizontal size={18} />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Chart menu</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" sideOffset={8} className="w-64 border-border bg-card text-card-foreground">
                  <DropdownMenuLabel className="font-normal">
                    <span className="block text-xs uppercase tracking-wide text-muted-foreground">Access</span>
                    <span className="mt-0.5 block font-medium">
                      {isAdmin ? "Administrator" : editMode ? "Editing unlocked" : "View only"}
                    </span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />

                  {isAdmin && (
                    <>
                      <DropdownMenuItem onSelect={() => void handleShare()}>
                        <Share2 size={15} className="mr-2" />
                        Copy share link
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <a href="../admin.html">
                          <ShieldCheck size={15} className="mr-2" />
                          Open admin console
                        </a>
                      </DropdownMenuItem>
                      {hasEditPin && (
                        <DropdownMenuItem
                          onSelect={() => void handleRegenerateEditPin()}
                          disabled={isRegeneratingEditPin}
                        >
                          <KeyRound size={15} className="mr-2" />
                          {isRegeneratingEditPin ? "Generating edit PIN…" : "Generate new edit PIN"}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuCheckboxItem
                        checked={viewPinRequired}
                        onCheckedChange={(checked) => void handleToggleViewPin(checked === true)}
                        onSelect={(event) => event.preventDefault()}
                        disabled={isTogglingViewPin}
                      >
                        Require a PIN to view
                      </DropdownMenuCheckboxItem>
                      {viewPinRequired && hasViewPin && (
                        <DropdownMenuItem
                          onSelect={() => void handleRegenerateViewPin()}
                          disabled={isRegeneratingViewPin}
                        >
                          <Eye size={15} className="mr-2" />
                          {isRegeneratingViewPin ? "Generating view PIN…" : "Generate new view PIN"}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                    </>
                  )}

                  <DropdownMenuItem onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}>
                    {theme === "dark" ? <Sun size={15} className="mr-2" /> : <Moon size={15} className="mr-2" />}
                    Use {theme === "dark" ? "light" : "dark"} theme
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onOpenVersions}>
                    <History size={15} className="mr-2" />
                    Saved versions{versionCount ? ` (${versionCount})` : ""}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={isAdmin ? onBackToManager : () => { window.location.href = "../index.html"; }}
                  >
                    <ArrowLeft size={15} className="mr-2" />
                    {isAdmin ? "Back to seating charts" : "Back to wedding site"}
                  </DropdownMenuItem>
                  {editMode && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={onReset}
                        className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                      >
                        <RotateCcw size={15} className="mr-2" />
                        Reset chart
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <Input
            value={eventTitle}
            onChange={(event) => setEventTitle(event.target.value)}
            className="h-9 w-full bg-card/60 text-center text-base font-semibold md:hidden"
            placeholder="Enter Event Title"
            aria-label="Event Title"
            disabled={!editMode}
          />

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className={editMode ? "contents" : "hidden"}>
            {!isVenueSpacePresent ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    onClick={onAddVenueSpace}
                    className="h-9 bg-primary/90 font-medium text-primary-foreground shadow-sm hover:bg-primary"
                  >
                    <BookOpen className="mr-2" size={16} strokeWidth={1.5} />
                    Draw Event Space
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="border-border bg-card text-card-foreground">
                  <p>Define the usable event area</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <>
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          disabled={!isVenueSpacePresent}
                          className="h-9 bg-primary/90 font-medium text-primary-foreground shadow-sm hover:bg-primary dark:glow-subtle"
                        >
                          <Utensils className="mr-2" size={16} strokeWidth={1.5} />
                          Add Table
                          <ChevronDown className="ml-1.5" size={14} strokeWidth={1.5} />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent className="border-border bg-card text-card-foreground">
                      <p>Add a table with seats for guests</p>
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="start" className="border-border bg-card text-card-foreground">
                    <DropdownMenuItem onClick={() => onAddTable("round")}>
                      <Circle className="mr-2" size={14} strokeWidth={1.5} />
                      Round Table
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onAddTable("rectangle")}>
                      <RectangleHorizontal className="mr-2" size={14} strokeWidth={1.5} />
                      Rectangular Table
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onAddVenueElement}
                      disabled={!isVenueSpacePresent}
                      className="h-9 shrink-0 shadow-sm"
                      aria-label="Add custom element"
                    >
                      <Armchair className="sm:mr-2" size={16} strokeWidth={1.5} />
                      <span className="hidden sm:inline">Add Element</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="border-border bg-card text-card-foreground">
                    <p>Add a dance floor, bar, or other venue feature</p>
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onToggleVenueLock}
                      className="h-9 shrink-0 shadow-sm"
                      aria-label={isVenueSpaceLocked ? "Unlock event space" : "Lock event space"}
                    >
                      {isVenueSpaceLocked ? <Unlock className="sm:mr-2" size={16} strokeWidth={1.5} /> : <Lock className="sm:mr-2" size={16} strokeWidth={1.5} />}
                      <span className="hidden sm:inline">{isVenueSpaceLocked ? "Unlock Space" : "Lock Space"}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="border-border bg-card text-card-foreground">
                    <p>{isVenueSpaceLocked ? "Allow changes to the event space" : "Prevent accidental event-space changes"}</p>
                  </TooltipContent>
                </Tooltip>
              </>
            )}

            <input
              ref={backgroundFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleBackgroundFileChange}
              disabled={!editMode}
            />
            {!backgroundImage ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => backgroundFileInputRef.current?.click()}
                    disabled={!editMode}
                    className="h-9 shrink-0 shadow-sm"
                    aria-label="Add background image"
                  >
                    <ImagePlus className="sm:mr-2" size={16} strokeWidth={1.5} />
                    <span className="hidden sm:inline">Background</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-72 border-border bg-card text-card-foreground">
                  <p>Upload a floorplan image to trace and arrange tables over</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!editMode}
                    className="h-9 shrink-0 shadow-sm"
                    aria-label="Background image settings"
                  >
                    <ImageIcon className="sm:mr-2" size={16} strokeWidth={1.5} />
                    <span className="hidden sm:inline">Background</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 border-border bg-card text-card-foreground" align="start">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Background Image</span>
                      <Button size="sm" variant="ghost" onClick={onSelectBackgroundImage} disabled={!editMode}>
                        Edit Placement
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Opacity</span>
                        <span className="tabular-nums">{Math.round(opacityDraft ?? backgroundImage.opacity * 100)}%</span>
                      </div>
                      <Slider
                        value={[opacityDraft ?? backgroundImage.opacity * 100]}
                        min={5}
                        max={100}
                        step={5}
                        disabled={!editMode}
                        onValueChange={([value]) => setOpacityDraft(value)}
                        onValueCommit={([value]) => {
                          onSetBackgroundOpacity(value / 100);
                          setOpacityDraft(null);
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={onToggleBackgroundLock} disabled={!editMode} className="flex-1">
                        {backgroundImage.locked ? <Unlock className="mr-2" size={14} strokeWidth={1.5} /> : <Lock className="mr-2" size={14} strokeWidth={1.5} />}
                        {backgroundImage.locked ? "Unlock" : "Lock"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => backgroundFileInputRef.current?.click()} disabled={!editMode} className="flex-1">
                        <ImagePlus className="mr-2" size={14} strokeWidth={1.5} />
                        Replace
                      </Button>
                      <Button size="sm" variant="destructive" onClick={onRemoveBackgroundImage} disabled={!editMode} aria-label="Remove background image">
                        <Trash2 size={14} strokeWidth={1.5} />
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )}
            </div>

            {!isAdmin && !editMode && hasEditPin && (
              <form
                className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handlePinUnlock();
                }}
              >
                <Input
                  type="password"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={4}
                  placeholder="Edit PIN"
                  value={pinEntry}
                  onChange={(event) => setPinEntry(event.target.value.replace(/\D/g, ""))}
                  className="h-9 min-w-0 flex-1 bg-card/60 text-center font-mono tracking-widest sm:w-28 sm:flex-none"
                  aria-label="Enter this chart's 4-digit edit PIN"
                  disabled={isPinSubmitting}
                />
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  disabled={isPinSubmitting || pinEntry.length !== 4}
                  className="h-9 shrink-0 border-primary/50 text-primary shadow-sm hover:bg-primary/5 hover:text-primary"
                >
                  <Unlock size={16} className="mr-1.5" />
                  {isPinSubmitting ? "Unlocking…" : "Unlock editing"}
                </Button>
              </form>
            )}
          </div>
        </div>
      </TooltipProvider>
    </header>
  );
};
