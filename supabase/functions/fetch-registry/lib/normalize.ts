import { RawItem, RegistryItem } from "../types.ts";

export const SOURCE_IMAGE_HINTS = [
  "source",
  "original",
  "large",
  "full",
  "zoom",
  "hires",
  "highres",
];

export const THUMBNAIL_IMAGE_HINTS = [
  "thumb",
  "thumbnail",
  "small",
  "icon",
  "mini",
];

export const RETAILER_PDP_HINTS = [
  "/dp/",
  "/gp/product/",
  "/product/",
  "/products/",
  "/p/",
  "/itm/",
];

export const MYREGISTRY_ORIGIN = "https://www.myregistry.com";

export function toNumber(value: unknown): number | null {
  if (typeof value === "number" && isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.]/g, "");
    const parsed = parseFloat(cleaned);
    return isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toInt(value: unknown): number | null {
  const n = toNumber(value);
  return n !== null ? Math.round(n) : null;
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(
      /&#(\d+);/g,
      (_full, code) => String.fromCharCode(parseInt(code, 10)),
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_full, code) => String.fromCharCode(parseInt(code, 16)),
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

export function stripHtml(value: string | null): string | null {
  if (!value) return null;
  const stripped = decodeHtmlEntities(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return stripped || null;
}

export function toTextValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeHttpUrlCandidate(
  value: string,
  baseUrl: string,
): string | null {
  const trimmed = value.trim();
  if (
    !trimmed || trimmed === "#" ||
    /^(javascript|data|vbscript|file):/i.test(trimmed)
  ) {
    return null;
  }
  try {
    const url = new URL(trimmed, baseUrl);
    return isHttpUrl(url.toString()) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function getHostName(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isProbablyImageUrl(value: string): boolean {
  const lower = value.toLowerCase();
  if (/\.(avif|bmp|gif|heic|jpeg|jpg|png|svg|webp)(?:[?#]|$)/i.test(lower)) {
    return true;
  }
  return lower.includes("/image") || lower.includes("giftimages");
}

export function isLowQualityImageUrl(value: string | null | undefined): boolean {
  if (!value) return true;
  const lower = value.toLowerCase();
  if (THUMBNAIL_IMAGE_HINTS.some((hint) => lower.includes(hint))) return true;
  const tinySizeMatch = lower.match(
    /(?:[?&](?:w|width|h|height)=)(\d{1,3})(?:[&#]|$)/,
  );
  if (tinySizeMatch) {
    const size = parseInt(tinySizeMatch[1], 10);
    if (Number.isFinite(size) && size <= 160) return true;
  }
  return false;
}

export function isMyRegistryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === MYREGISTRY_ORIGIN;
  } catch {
    return false;
  }
}

export function isMyRegistryFlowUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === MYREGISTRY_ORIGIN &&
      /\/Visitors\/Giftlist\/(?:PurchaseAssistant|CashGiftProcess)\.aspx$/i
        .test(url.pathname);
  } catch {
    return false;
  }
}

export function isLikelyRetailerPdpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const lowerPath = url.pathname.toLowerCase();
    if (RETAILER_PDP_HINTS.some((hint) => lowerPath.includes(hint))) {
      return true;
    }
    return /(asin|sku|item|product(?:id)?|pid)/i.test(url.search);
  } catch {
    return false;
  }
}

export function extractEmbeddedUrlCandidates(value: string): string[] {
  try {
    const url = new URL(value);
    const embeddedCandidates: string[] = [];
    for (const [key, paramValue] of url.searchParams.entries()) {
      if (
        !/(url|target|redirect|dest|retailer|product|item|link)/i.test(key)
      ) {
        continue;
      }
      const normalizedValue = paramValue.trim();
      if (!normalizedValue) continue;
      if (isHttpUrl(normalizedValue)) embeddedCandidates.push(normalizedValue);
    }
    return embeddedCandidates;
  } catch {
    return [];
  }
}

export function getDisplayImageUrl(item: RegistryItem): string | null {
  return item.resolved_image_url ?? item.registry_image_url ?? item.image_url ??
    null;
}

export function normalizeImageIdentity(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.hostname.toLowerCase()}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function isDuplicateImageCandidate(
  value: string,
  currentImageUrl: string | null,
): boolean {
  if (!currentImageUrl) return false;
  const candidateIdentity = normalizeImageIdentity(value);
  const currentIdentity = normalizeImageIdentity(currentImageUrl);
  if (!candidateIdentity || !currentIdentity) return value === currentImageUrl;
  return candidateIdentity === currentIdentity;
}
