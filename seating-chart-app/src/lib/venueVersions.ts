import type {
  VenueSnapshotData,
  VenueVersion,
  VenueVersionSnapshotData,
} from "@shared/types/venue";
import type { BackgroundImage } from "@/types/seatingChart";

export const MAX_SAVED_VERSIONS = 25;
export const MAX_VERSION_BACKGROUND_ASSET_BYTES = 12 * 1024 * 1024;

export const versionBackgroundAssetBytes = (assets: Record<string, string>) =>
  Object.values(assets).reduce((total, dataUrl) => total + dataUrl.length, 0);

export const versionAssetSaveError = (assets: Record<string, string>) =>
  versionBackgroundAssetBytes(assets) > MAX_VERSION_BACKGROUND_ASSET_BYTES
    ? "Saved versions can store up to 12 MB of unique background images. Delete a saved version with an older background, then try again."
    : null;

export const versionSaveError = (name: string, versions: VenueVersion[]) => {
  const normalizedName = name.trim();
  if (!normalizedName) return "A version name is required.";
  if (versions.some((version) => version.name.toLowerCase() === normalizedName.toLowerCase())) {
    return "That version name is already in use.";
  }
  if (versions.length >= MAX_SAVED_VERSIONS) {
    return `Up to ${MAX_SAVED_VERSIONS} saved versions are supported.`;
  }
  return null;
};

const assetFingerprint = (dataUrl: string) => {
  let hash = 2166136261;
  for (let index = 0; index < dataUrl.length; index += 1) {
    hash ^= dataUrl.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `background-${(hash >>> 0).toString(36)}-${dataUrl.length}`;
};

export const createVersionSnapshot = (
  snapshot: VenueSnapshotData,
  currentAssets: Record<string, string>,
): { data: VenueVersionSnapshotData; assets: Record<string, string> } => {
  let assets = currentAssets;
  const shapes = snapshot.shapes.map((shape) => {
    if (shape.type !== "backgroundImage") return shape;

    let assetId = assetFingerprint(shape.dataUrl);
    let suffix = 1;
    while (assets[assetId] && assets[assetId] !== shape.dataUrl) {
      assetId = `${assetFingerprint(shape.dataUrl)}-${suffix}`;
      suffix += 1;
    }
    if (!assets[assetId]) assets = { ...assets, [assetId]: shape.dataUrl };

    const { dataUrl: _dataUrl, ...metadata } = shape;
    return { ...metadata, versionAssetId: assetId };
  });

  return {
    data: {
      shapes,
      guests: snapshot.guests,
      eventTitle: snapshot.eventTitle,
      tableCounter: snapshot.tableCounter,
    },
    assets,
  };
};

export const hydrateVersionSnapshot = (
  data: VenueVersionSnapshotData,
  assets: Record<string, string>,
): VenueSnapshotData => ({
  shapes: data.shapes.map((shape) => {
    if (shape.type !== "backgroundImage") return shape;
    const dataUrl = shape.dataUrl || (shape.versionAssetId ? assets[shape.versionAssetId] : undefined);
    if (!dataUrl) throw new Error("This version's background image is unavailable.");
    const { versionAssetId: _assetId, ...metadata } = shape;
    return { ...metadata, dataUrl } as BackgroundImage;
  }),
  guests: data.guests,
  eventTitle: data.eventTitle,
  tableCounter: data.tableCounter,
});

export const pruneVersionAssets = (
  versions: VenueVersion[],
  assets: Record<string, string>,
) => {
  const usedIds = new Set<string>();
  versions.forEach((version) => {
    version.data.shapes.forEach((shape) => {
      if (shape.type === "backgroundImage" && shape.versionAssetId) {
        usedIds.add(shape.versionAssetId);
      }
    });
  });
  return Object.fromEntries(
    Object.entries(assets).filter(([assetId]) => usedIds.has(assetId)),
  );
};
