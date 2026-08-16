import { CircleHelp, Info, X as CloseIcon } from "lucide-react";
import { useState } from "react";

const DISMISSED_STORAGE_KEY = "seating-chart.canvas-tips-dismissed";

const getInitialVisibility = () => {
  if (typeof window === "undefined") {
    return true;
  }

  try {
    return window.localStorage.getItem(DISMISSED_STORAGE_KEY) !== "true";
  } catch {
    return true;
  }
};

export const CanvasTipsOverlay: React.FC = () => {
  const [isVisible, setIsVisible] = useState(getInitialVisibility);

  const updateVisibility = (visible: boolean) => {
    setIsVisible(visible);

    try {
      if (visible) {
        window.localStorage.removeItem(DISMISSED_STORAGE_KEY);
      } else {
        window.localStorage.setItem(DISMISSED_STORAGE_KEY, "true");
      }
    } catch {
      // Storage can be unavailable in privacy modes; the in-memory state still works.
    }
  };

  if (!isVisible) {
    return (
      <button
        type="button"
        onClick={() => updateVisibility(true)}
        className="absolute bottom-3 left-3 z-20 inline-flex min-h-10 items-center gap-2 rounded-full border border-border/60 bg-card/90 px-3 py-2 text-xs font-medium text-foreground shadow-md backdrop-blur-sm transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:bottom-4 sm:left-4"
        aria-label="Show canvas tips"
        aria-expanded="false"
      >
        <CircleHelp size={16} aria-hidden="true" />
        Tips
      </button>
    );
  }

  return (
    <section
      id="canvas-tips"
      aria-label="Canvas tips"
      className="absolute bottom-3 left-3 right-3 z-20 max-h-[42dvh] overflow-y-auto overscroll-contain rounded-lg border border-border/40 bg-card/90 p-3 text-sm text-muted-foreground shadow-lg backdrop-blur-sm sm:bottom-4 sm:left-4 sm:right-auto sm:max-h-none sm:w-80 sm:p-4"
    >
      <button
        type="button"
        onClick={() => updateVisibility(false)}
        className="absolute right-1.5 top-1.5 rounded-full p-1 text-muted-foreground/70 transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Hide canvas tips"
      >
        <CloseIcon size={14} strokeWidth={2.5} aria-hidden="true" />
      </button>
      <h3 className="mb-2 flex items-center pr-7 text-sm font-semibold text-foreground/90">
        <Info
          className="mr-1.5 text-accent/80"
          size={15}
          strokeWidth={1.5}
          aria-hidden="true"
        />
        Quick Tips
      </h3>
      <div className="space-y-2">
        <p className="flex items-center text-xs leading-relaxed">
          <span className="mr-1.5 text-xs font-semibold text-primary opacity-80">
            ➤
          </span>{" "}
          Use{" "}
          <kbd className="mx-1 rounded bg-muted/80 px-1.5 py-0.5 text-xs shadow-sm">
            Alt + Mouse
          </kbd>{" "}
          to pan
        </p>
        <p className="flex items-center text-xs leading-relaxed">
          <span className="mr-1.5 text-xs font-semibold text-primary opacity-80">
            ➤
          </span>{" "}
          <kbd className="mx-1 rounded bg-muted/80 px-1.5 py-0.5 text-xs shadow-sm">
            Scroll
          </kbd>{" "}
          to zoom in/out
        </p>
        <p className="flex items-center text-xs leading-relaxed">
          <span className="mr-1.5 text-xs font-semibold text-primary opacity-80">
            ➤
          </span>{" "}
          Hold{" "}
          <kbd className="mx-1 rounded bg-muted/80 px-1.5 py-0.5 text-xs shadow-sm">
            Ctrl / Cmd
          </kbd>{" "}
          and click tables to multi-select
        </p>
        <p className="flex items-center text-xs leading-relaxed">
          <span className="mr-1.5 text-xs font-semibold text-primary opacity-80">
            ➤
          </span>{" "}
          Double-click text to rename elements
        </p>
        <p className="mt-1 flex items-center border-t border-border/30 pt-1 text-xs leading-relaxed">
          <span className="mr-1.5 text-xs font-semibold text-destructive opacity-90">
            ➤
          </span>{" "}
          Press{" "}
          <kbd className="mx-1 rounded bg-muted/80 px-1.5 py-0.5 text-xs shadow-sm">
            Delete
          </kbd>{" "}
          to remove selected element
        </p>
      </div>
      <div className="mt-2 border-t border-border/30 pt-2">
        <h4 className="text-xs font-semibold text-foreground/80 mb-1.5">
          Chair Legend:
        </h4>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center space-x-2">
            <div
              className="flex h-3.5 w-3.5 items-center justify-center rounded-full border"
              style={{ backgroundColor: "#7A9A1F", borderColor: "#2E3A1C" }}
            >
              <div
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor: "#FFFFFF",
                  borderColor: "#54604A",
                  borderWidth: "0.5px",
                }} // Center dot: --surface, --inkSoft border
              />
            </div>
            <span className="text-xs">Occupied Seat</span>
          </div>
          <div className="flex items-center space-x-2">
            <div
              className="h-3.5 w-3.5 rounded-full border-2"
              style={{ backgroundColor: "#F3F0E7", borderColor: "#54604A" }}
            />
            <span className="text-xs">Empty Seat</span>
          </div>
        </div>
      </div>
    </section>
  );
};
