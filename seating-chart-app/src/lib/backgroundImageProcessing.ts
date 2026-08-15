// Turns an arbitrary uploaded File into a self-contained data: URI safe to
// embed in venue_data — no separate storage bucket or fetch step, so
// rendering the background image never has a network dependency of its
// own. Two goals drive everything here:
//
//   1. Accept broadly. Rather than maintain a hardcoded list of "allowed"
//      image MIME types (which would reject formats a given browser can
//      perfectly well decode, or accept ones it can't), we just attempt
//      to decode the file as an image and trust the result — whatever a
//      browser can natively render as an <img> (JPEG, PNG, GIF, WebP,
//      BMP, AVIF, SVG, ...) works, and anything it can't fails here with
//      a clear message instead of silently breaking the canvas later.
//   2. Never let one huge or pathological file bloat the saved chart or
//      choke the canvas. Oversized raster images are progressively
//      downscaled and recompressed until they fit a hard size cap; if
//      even the smallest/lowest-quality attempt doesn't fit, we give up
//      with a clear error rather than accept something that'll be slow
//      to save/load. SVGs (already vector, normally tiny) are passed
//      through as-is but still size-capped, since a bloated SVG (e.g.
//      one with embedded raster data) is exactly the kind of asset this
//      guards against.

// Reject before even attempting to decode — protects against hanging the
// browser on a pathologically large file (e.g. a multi-hundred-MB raw
// photo or scan).
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024; // 40MB

// SVGs are stored verbatim (no re-encoding — they're already vector), but
// still capped: a "simple floorplan trace" SVG this big almost certainly
// has something bloated embedded in it (e.g. a raster image inlined as a
// data URI) rather than being a legitimately huge line drawing.
const MAX_SVG_BYTES = 3 * 1024 * 1024; // 3MB

// If the original file is already at or under this size and not larger
// than our biggest downscale step, it's embedded byte-for-byte — full
// original quality preserved, no lossy re-encoding for the common case of
// an already-reasonable photo or export.
const PASSTHROUGH_MAX_BYTES = 2 * 1024 * 1024; // 2MB

// The hard cap the final embedded image must fit under, after any
// downscaling/recompression — keeps the saved chart's payload small and
// the canvas fast regardless of what was originally uploaded.
const FINAL_SIZE_CAP_BYTES = 2 * 1024 * 1024; // 2MB

// Progressively smaller long-edge targets tried in order until the
// encoded result fits under FINAL_SIZE_CAP_BYTES.
const MAX_DIMENSION_STEPS = [2200, 1600, 1100, 800];

// Progressively lower WebP quality tried at each dimension step.
const QUALITY_STEPS = [0.85, 0.7, 0.55];

export interface ProcessedBackgroundImage {
  dataUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  // True if the image had to be shrunk and/or recompressed to fit the
  // size cap — surfaced so the caller can let the user know why.
  wasDownscaled: boolean;
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode failed"));
    img.src = url;
  });
}

function isSvgFile(file: File): boolean {
  return file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsText(file);
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });
}

// Byte length of the data a data: URI actually encodes, from its base64
// payload — used to enforce the size caps against the *encoded* result,
// not the original file (they can differ a lot after re-compression).
function dataUrlByteLength(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(",");
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  const padding = base64.match(/=+$/)?.[0].length ?? 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function processSvg(file: File): Promise<ProcessedBackgroundImage> {
  if (file.size > MAX_SVG_BYTES) {
    throw new Error(
      `That SVG is too large (${formatMB(file.size)}) — try flattening or simplifying it first (max ${formatMB(MAX_SVG_BYTES)}).`,
    );
  }
  const svgText = await readFileAsText(file);
  const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgText)))}`;
  // Confirm it actually decodes as an image — catches a non-SVG file
  // renamed to .svg, or markup a browser can't render, before it ever
  // reaches the canvas.
  let img: HTMLImageElement;
  try {
    img = await loadImageElement(dataUrl);
  } catch {
    throw new Error("This browser couldn't render that SVG.");
  }
  // An SVG without an explicit width/height/viewBox can report a natural
  // size of 0 — fall back to a sane default so the shape isn't invisible.
  const naturalWidth = img.naturalWidth || 800;
  const naturalHeight = img.naturalHeight || 600;
  return { dataUrl, naturalWidth, naturalHeight, wasDownscaled: false };
}

async function processRaster(file: File): Promise<ProcessedBackgroundImage> {
  const objectUrl = URL.createObjectURL(file);
  let img: HTMLImageElement;
  try {
    img = await loadImageElement(objectUrl);
  } catch {
    throw new Error(
      "This browser couldn't read that as an image. JPEG, PNG, WebP, GIF, SVG, BMP, and AVIF all work — try one of those.",
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  const naturalWidth = img.naturalWidth;
  const naturalHeight = img.naturalHeight;
  if (!naturalWidth || !naturalHeight) {
    throw new Error("That image has no visible size — it may be corrupted.");
  }

  // Common case: a reasonably-sized image — embed the original bytes
  // untouched rather than lossily re-encoding something that was already
  // fine.
  const biggestStep = MAX_DIMENSION_STEPS[0];
  if (
    file.size <= PASSTHROUGH_MAX_BYTES &&
    naturalWidth <= biggestStep &&
    naturalHeight <= biggestStep
  ) {
    const dataUrl = await readFileAsDataUrl(file);
    return { dataUrl, naturalWidth, naturalHeight, wasDownscaled: false };
  }

  // Otherwise: progressively shrink and recompress (as WebP, for its
  // compression and transparency support) until it fits the size cap.
  let wasDownscaled = false;
  for (const maxDim of MAX_DIMENSION_STEPS) {
    const longEdge = Math.max(naturalWidth, naturalHeight);
    const scale = Math.min(1, maxDim / longEdge);
    const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
    const targetHeight = Math.max(1, Math.round(naturalHeight * scale));
    if (scale < 1) wasDownscaled = true;

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't process images right now.");
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    for (const quality of QUALITY_STEPS) {
      // If the browser can't encode WebP, toDataURL falls back to PNG
      // per spec — still a valid, working result, just larger, so the
      // size-cap check below still does its job either way.
      const dataUrl = canvas.toDataURL("image/webp", quality);
      wasDownscaled = true;
      if (dataUrlByteLength(dataUrl) <= FINAL_SIZE_CAP_BYTES) {
        return { dataUrl, naturalWidth: targetWidth, naturalHeight: targetHeight, wasDownscaled };
      }
    }
  }

  throw new Error(
    `That image is too detailed to store even after shrinking it — try cropping it or exporting a smaller version first (max ${formatMB(FINAL_SIZE_CAP_BYTES)}).`,
  );
}

export async function processBackgroundImageFile(
  file: File,
): Promise<ProcessedBackgroundImage> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `That file is too large (${formatMB(file.size)}). Try one under ${formatMB(MAX_UPLOAD_BYTES)}.`,
    );
  }
  return isSvgFile(file) ? processSvg(file) : processRaster(file);
}
