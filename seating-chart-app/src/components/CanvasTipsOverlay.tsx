import { Info, X as CloseIcon } from "lucide-react";
import { useState } from "react";

export const CanvasTipsOverlay: React.FC = () => {
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="absolute bottom-4 left-4 z-20 bg-card/70 backdrop-blur-sm rounded-lg p-4 shadow-lg text-sm text-muted-foreground space-y-2 border border-border/40 max-w-xs">
      <button
        onClick={() => setIsVisible(false)}
        className="absolute top-1.5 right-1.5 p-1 text-muted-foreground/70 hover:text-foreground hover:bg-muted/50 rounded-full transition-colors"
        aria-label="Close tips"
      >
        <CloseIcon size={14} strokeWidth={2.5} />
      </button>
      <h3 className="text-sm font-semibold text-foreground/90 mb-1 flex items-center">
        <Info className="mr-1.5 text-accent/80" size={15} strokeWidth={1.5} />
        Quick Tips
      </h3>
      <p className="flex items-center text-xs leading-relaxed">
        <span className="text-primary font-semibold mr-1.5 text-xs opacity-80">
          ➤
        </span>{" "}
        Use{" "}
        <kbd className="px-1.5 py-0.5 rounded bg-muted/80 mx-1 text-xs shadow-sm">
          Alt + Mouse
        </kbd>{" "}
        to pan
      </p>
      <p className="flex items-center text-xs leading-relaxed">
        <span className="text-primary font-semibold mr-1.5 text-xs opacity-80">
          ➤
        </span>{" "}
        <kbd className="px-1.5 py-0.5 rounded bg-muted/80 mx-1 text-xs shadow-sm">
          Scroll
        </kbd>{" "}
        to zoom in/out
      </p>
      <p className="flex items-center text-xs leading-relaxed">
        <span className="text-primary font-semibold mr-1.5 text-xs opacity-80">
          ➤
        </span>{" "}
        Double-click text to rename elements
      </p>
      <p className="flex items-center text-xs leading-relaxed pt-1 mt-1 border-t border-border/30">
        <span className="text-destructive font-semibold mr-1.5 text-xs opacity-90">
          ➤
        </span>{" "}
        Press{" "}
        <kbd className="px-1.5 py-0.5 rounded bg-muted/80 mx-1 text-xs shadow-sm">
          Delete
        </kbd>{" "}
        to remove selected element
      </p>
      {/* Chair Legend Section */}
      <div className="pt-2 mt-2 border-t border-border/30">
        <h4 className="text-xs font-semibold text-foreground/80 mb-1.5">
          Chair Legend:
        </h4>
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2">
            <div
              className="w-3.5 h-3.5 rounded-full flex items-center justify-center border"
              style={{ backgroundColor: "#7A9A1F", borderColor: "#2E3A1C" }} // Occupied: --accent olive, --deep border
            >
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  backgroundColor: "#FFFFFF",
                  borderColor: "#54604A",
                  borderWidth: "0.5px",
                }} // Center dot: --surface, --inkSoft border
              ></div>
            </div>
            <span className="text-xs">Occupied Seat</span>
          </div>
          <div className="flex items-center space-x-2">
            <div
              className="w-3.5 h-3.5 rounded-full border-2"
              style={{ backgroundColor: "#F3F0E7", borderColor: "#54604A" }} // Empty: --light-gray, --inkSoft border
            ></div>
            <span className="text-xs">Empty Seat</span>
          </div>
        </div>
      </div>
    </div>
  );
};
