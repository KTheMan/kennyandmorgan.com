import type { Guest } from "../types/seatingChart";

/**
 * Finds the highest-numbered empty chair in the requested half-open range.
 * Capacity reduction works backward from the end so occupied guests keep
 * their relative order and a sparse layout compacts predictably.
 */
export const findSeatToRemove = (
  guests: Guest[],
  tableId: string,
  startIndex: number,
  endIndex: number,
): number | null => {
  const occupied = new Set(
    guests
      .filter(
        (guest) =>
          guest.tableId === tableId &&
          guest.chairIndex >= startIndex &&
          guest.chairIndex < endIndex,
      )
      .map((guest) => guest.chairIndex),
  );

  for (let chairIndex = endIndex - 1; chairIndex >= startIndex; chairIndex -= 1) {
    if (!occupied.has(chairIndex)) return chairIndex;
  }

  return null;
};

/** Renumbers every occupied chair after a removed gap without unseating anyone. */
export const compactGuestsAfterSeatRemoval = (
  guests: Guest[],
  tableId: string,
  removedChairIndex: number,
): Guest[] =>
  guests.map((guest) =>
    guest.tableId === tableId && guest.chairIndex > removedChairIndex
      ? { ...guest, chairIndex: guest.chairIndex - 1 }
      : guest,
  );
