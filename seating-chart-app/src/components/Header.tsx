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
} from "lucide-react";
import { useEffect, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAtom, useAtomValue } from "jotai";
import { eventTitleAtom, editModeAtom } from "@/lib/atoms";
import { useToast } from "@/components/ui/use-toast";
import { setEditPin as setVenueEditPin, setViewPin as setVenueViewPin } from "@/lib/api/venues";
import { tryVerifyAdminSession } from "@/lib/adminAuth";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            onClick={toggleTheme}
            className="border-accent/30 bg-accent/5 hover:bg-accent/15 hover:border-accent/50 relative h-10 w-10 shadow-sm transition-all duration-300"
          >
            <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all duration-300 dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all duration-300 dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Toggle theme</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Switch to {theme === "dark" ? "light" : "dark"} mode</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

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
  onReset: () => void;
  onAddTable: (shape?: "round" | "rectangle") => void;
  onAddVenueElement: () => void;
  onAddVenueSpace: () => void;
  isVenueSpacePresent: boolean;
  isVenueSpaceLocked: boolean;
  onToggleVenueLock: () => void;
  onShowDisabledInfo: () => void;
  saveStatus: SaveStatus;
  onToggleMobileSidebar: () => void;
  isMobileSidebarOpen: boolean;
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
  onReset,
  onAddTable,
  onAddVenueElement,
  onAddVenueSpace,
  isVenueSpacePresent,
  isVenueSpaceLocked,
  onToggleVenueLock,
  onShowDisabledInfo,
  saveStatus,
  onToggleMobileSidebar,
  isMobileSidebarOpen,
}) => {
  const [eventTitle, setEventTitle] = useAtom(eventTitleAtom);
  const editMode = useAtomValue(editModeAtom);
  const { toast } = useToast();

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
    <header className="relative bg-gradient-to-r from-card to-card/95 border-b border-border/40 shadow-sm px-4 sm:px-7 py-4 overflow-hidden">
      {/* Refined texture overlay */}
      <div className="absolute inset-0 texture-elegant pointer-events-none"></div>
      <div className="relative z-10 flex flex-wrap items-center justify-between">
        {/* Mobile Sidebar Toggle Button - visible only on small screens */}
        <div className="lg:hidden mr-2">
          {" "}
          {/* Container for the button, shows on <lg screens */}
          <Button
            variant="outline"
            size="icon"
            onClick={onToggleMobileSidebar}
            className="border-accent/30 bg-accent/5 hover:bg-accent/15 h-10 w-10 shadow-sm"
            aria-label="Toggle sidebar"
          >
            {isMobileSidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </Button>
        </div>

        {/* Item 1: Logo and app name */}
        <div className="flex-shrink-0 mr-3 sm:mr-4 flex items-center">
          {/* On small screens, only show the app name, on sm+ show icon too */}
          <span className="hidden sm:inline-flex items-center justify-center mr-2 text-primary/80">
            <Armchair size={24} strokeWidth={1.5} />
          </span>
          <h1 className="text-xl sm:text-2xl font-medium text-card-foreground tracking-wide">
            Seating Chart
          </h1>
        </div>

        {/* Item 2: Controls (Add Buttons) - adjust margins if needed due to toggle button */}
        <div className="flex items-center gap-2 sm:gap-3 order-3 lg:order-2 w-full lg:w-auto mt-3 lg:mt-0 justify-center lg:justify-start lg:mr-auto lg:ml-4">
          <TooltipProvider delayDuration={300}>
            {!isVenueSpacePresent ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onAddVenueSpace}
                    className="border-secondary/40 bg-secondary/5 hover:bg-secondary/15 text-foreground transition-all font-medium shadow-sm"
                  >
                    <BookOpen className="mr-2" size={16} strokeWidth={1.5} />
                    Draw Event Space
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="bg-card text-card-foreground border-border">
                  <p>First step: Add a Venue Space to define your event area</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      onClick={
                        !isVenueSpacePresent ? onShowDisabledInfo : undefined
                      }
                    >
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild disabled={!isVenueSpacePresent}>
                          <Button
                            size="sm"
                            disabled={!isVenueSpacePresent}
                            className="bg-primary/90 hover:bg-primary text-primary-foreground transition-all shadow-sm font-medium dark:glow-subtle"
                          >
                            <Utensils
                              className="mr-2"
                              size={16}
                              strokeWidth={1.5}
                            />
                            Add Table
                            <ChevronDown className="ml-1.5" size={14} strokeWidth={1.5} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="bg-card text-card-foreground border-border">
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
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="bg-card text-card-foreground border-border">
                    <p>Add a new table with seats for guests</p>
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      onClick={
                        !isVenueSpacePresent ? onShowDisabledInfo : undefined
                      }
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={onAddVenueElement}
                        disabled={!isVenueSpacePresent}
                        className="shadow-sm"
                      >
                        <Armchair
                          className="mr-2"
                          size={16}
                          strokeWidth={1.5}
                        />
                        Add Custom Element
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="bg-card text-card-foreground border-border">
                    <p>
                      Add decorative elements like dance floors, bars, or other
                      venue features
                    </p>
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={onToggleVenueLock}
                      className="bg-secondary/80 hover:bg-secondary text-secondary-foreground transition-all font-medium shadow-sm"
                    >
                      {isVenueSpaceLocked ? (
                        <>
                          <Unlock
                            className="mr-2"
                            size={16}
                            strokeWidth={1.5}
                          />{" "}
                          Unlock Space
                        </>
                      ) : (
                        <>
                          <Lock className="mr-2" size={16} strokeWidth={1.5} />{" "}
                          Lock Space
                        </>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-card text-card-foreground border-border">
                    <p>
                      {isVenueSpaceLocked
                        ? "Allow editing of the venue space"
                        : "Prevent accidental changes to venue space"}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </>
            )}
          </TooltipProvider>
        </div>

        {/* Item 3: Middle section - Event Title */}
        <div className="flex-grow max-w-[18rem] mr-2 ml-2 hidden md:block lg:order-3">
          <Input
            value={eventTitle}
            onChange={(e) => setEventTitle(e.target.value)}
            className="h-10 bg-card/60 border-border/30 focus:border-primary/50 focus:bg-card/80 text-xl font-bold text-center"
            placeholder="Enter Event Title"
            aria-label="Event Title"
            disabled={!editMode}
          />
        </div>

        {/* Right section - Stats and actions - ensure this section doesn't cause overflow with new button */}
        <div className="flex items-center space-x-2 sm:space-x-3 flex-shrink-0 order-2 lg:order-4">
          {/* Save Status Indicator */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "flex items-center rounded-md px-4 py-1.5 min-w-24 text-sm font-medium shadow-sm",
                    saveStatus === "saved" &&
                      "bg-muted/30 text-muted-foreground border border-muted",
                    saveStatus === "saving" &&
                      "bg-accent/40 text-accent-foreground",
                    saveStatus === "unsaved" &&
                      "bg-secondary/20 text-secondary-foreground",
                  )}
                >
                  {saveStatus === "saved" ? (
                    <>
                      <Check className="mr-1.5" size={16} strokeWidth={2} />{" "}
                      Saved
                    </>
                  ) : saveStatus === "saving" ? (
                    <>
                      <svg
                        className="mr-1.5 animate-spin h-4 w-4"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-1.5" size={16} strokeWidth={1.5} />{" "}
                      Unsaved
                    </>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent className="bg-card text-card-foreground border-border">
                <p>
                  {saveStatus === "saved"
                    ? "All changes are saved to localStorage"
                    : saveStatus === "saving"
                      ? "Saving changes..."
                      : "Changes will be auto-saved soon"}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Access indicator: admin (full access + share tools), editor
              (unlocked this venue's PIN), or viewer (read-only, with a
              PIN unlock form if this venue has one). This app has no
              login of its own — see AdminGate / VenueGate. */}
          {isAdmin ? (
            <>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href="../admin.html"
                      className="flex items-center bg-muted/30 text-muted-foreground border border-muted rounded-md px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-muted/50 transition-colors"
                    >
                      <ShieldCheck size={16} className="mr-1.5 text-primary/80" />
                      <span className="hidden sm:inline">Admin</span>
                    </a>
                  </TooltipTrigger>
                  <TooltipContent className="bg-card text-card-foreground border-border">
                    <p>Signed in via the wedding site's admin console.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" onClick={handleShare} className="shadow-sm">
                      <Share2 size={14} className="mr-1.5" /> Share
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-card text-card-foreground border-border">
                    <p>Copy this chart's link — viewing never needs a password.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {hasEditPin && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRegenerateEditPin}
                        disabled={isRegeneratingEditPin}
                        className="shadow-sm"
                      >
                        <KeyRound size={14} className="mr-1.5" />
                        {isRegeneratingEditPin ? "…" : "New Edit PIN"}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="bg-card text-card-foreground border-border">
                      <p>Generate a new edit PIN for this chart (invalidates the old one).</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1.5 bg-muted/20 border border-muted rounded-md px-2.5 py-1.5">
                      <Eye size={14} className="text-muted-foreground" />
                      <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
                        View PIN
                      </span>
                      <Switch
                        checked={viewPinRequired}
                        onCheckedChange={handleToggleViewPin}
                        disabled={isTogglingViewPin}
                        aria-label="Require a PIN to view this chart"
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="bg-card text-card-foreground border-border">
                    <p>
                      {viewPinRequired
                        ? "Only admin and people with a PIN can view this chart."
                        : "Anyone with the link can view this chart (default)."}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {viewPinRequired && hasViewPin && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRegenerateViewPin}
                        disabled={isRegeneratingViewPin}
                        className="shadow-sm"
                      >
                        <Eye size={14} className="mr-1.5" />
                        {isRegeneratingViewPin ? "…" : "New View PIN"}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="bg-card text-card-foreground border-border">
                      <p>Generate a new view PIN for this chart (invalidates the old one).</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </>
          ) : editMode ? (
            <div className="flex items-center bg-[#EEF3DC] text-[#2E3A1C] border border-[#BFCB8A] rounded-md px-3 py-1.5 text-sm font-medium shadow-sm">
              <KeyRound size={16} className="mr-1.5" />
              <span className="hidden sm:inline">Editing</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <div className="flex items-center bg-muted/30 text-muted-foreground border border-muted rounded-md px-3 py-1.5 text-sm font-medium shadow-sm">
                <Eye size={16} className="mr-1.5" />
                <span className="hidden sm:inline">View Only</span>
              </div>
              {hasEditPin && (
                <>
                  <Input
                    type="password"
                    maxLength={4}
                    placeholder="PIN"
                    value={pinEntry}
                    onChange={(e) => setPinEntry(e.target.value.replace(/\D/g, ""))}
                    className="h-10 w-20 bg-card/60 border-border/30 focus:border-primary/50 focus:bg-card/80 text-center font-mono tracking-widest"
                    aria-label="Enter this chart's 4-digit edit PIN"
                    disabled={isPinSubmitting}
                  />
                  <Button
                    variant="outline"
                    size="default"
                    onClick={handlePinUnlock}
                    disabled={isPinSubmitting || pinEntry.length !== 4}
                    className="h-10 shadow-sm border-primary/50 text-primary hover:bg-primary/5 hover:text-primary"
                  >
                    <Unlock size={16} className="mr-1.5" />
                    {isPinSubmitting ? "…" : "Unlock"}
                  </Button>
                </>
              )}
            </div>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={isAdmin ? onBackToManager : () => { window.location.href = "../index.html"; }}
                  className="h-10 w-10 border-accent/30 bg-accent/5 hover:bg-accent/15 shadow-sm"
                  aria-label={isAdmin ? "Back to Seating Charts" : "Back to wedding site"}
                >
                  <ArrowLeft size={18} strokeWidth={1.5} />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="bg-card text-card-foreground border-border">
                <p>{isAdmin ? "Back to Seating Charts" : "Back to the wedding site"}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <div className="bg-card/80 backdrop-blur-sm border border-border/30 rounded-lg px-4 py-2.5 shadow-sm transition-all hover:shadow-md">
            <div className="flex items-center">
              <Users
                size={18}
                className="mr-2 text-primary/80"
                strokeWidth={1.5}
              />
              <span className="font-medium text-foreground/90">
                {totalGuests} {totalGuests === 1 ? "Guest" : "Guests"}
              </span>
            </div>
          </div>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="destructive"
                  onClick={onReset}
                  className="bg-destructive/90 hover:bg-destructive text-destructive-foreground py-2.5 font-medium shadow-sm transition-all duration-300"
                >
                  <RotateCcw size={16} className="mr-2" strokeWidth={1.5} />
                  Reset
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Clear the canvas and start fresh</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <ThemeToggle />
        </div>

        {/* Event Title for smaller screens (md:hidden ensures it does not overlap with the md:block version) */}
        <div className="w-full mt-3 md:hidden order-5">
          <Input
            value={eventTitle}
            onChange={(e) => setEventTitle(e.target.value)}
            className="h-10 bg-card/60 border-border/30 focus:border-primary/50 focus:bg-card/80 text-xl font-bold text-center"
            placeholder="Enter Event Title"
            aria-label="Event Title"
            disabled={!editMode}
          />
        </div>
      </div>
    </header>
  );
};
