import type { Guest, Table } from "@/types/seatingChart";

export const SEATING_SPREADSHEET_HEADERS = [
  "Table Number",
  "Seat Number",
  "Guest Name",
  "Food Choice",
  "Allergies",
] as const;

export interface SeatingSpreadsheetRow {
  tableNumber: number;
  seatNumber: number;
  guestName: string;
  foodChoice: string;
  allergies: string;
}

export const buildSeatingSpreadsheetRows = (
  tables: Table[],
  guests: Guest[],
): SeatingSpreadsheetRow[] => {
  const tableNumberById = new Map(
    tables.map((table) => [table.id, table.number]),
  );

  return guests
    .flatMap((guest) => {
      const tableNumber = tableNumberById.get(guest.tableId);
      if (tableNumber === undefined || typeof guest.chairIndex !== "number") {
        return [];
      }

      return [{
        tableNumber,
        seatNumber: guest.chairIndex + 1,
        guestName: guest.fullName,
        foodChoice: guest.mealChoice?.trim() ?? "",
        allergies: guest.dietaryNotes?.trim() ?? "",
      }];
    })
    .sort(
      (left, right) =>
        left.tableNumber - right.tableNumber ||
        left.seatNumber - right.seatNumber ||
        left.guestName.localeCompare(right.guestName),
    );
};

const escapeCsvCell = (value: string | number) => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const buildSeatingSpreadsheetCsv = (
  tables: Table[],
  guests: Guest[],
) => {
  const rows = buildSeatingSpreadsheetRows(tables, guests);
  const csvRows = [
    SEATING_SPREADSHEET_HEADERS,
    ...rows.map((row) => [
      row.tableNumber,
      row.seatNumber,
      row.guestName,
      row.foodChoice,
      row.allergies,
    ]),
  ];

  return `\uFEFF${csvRows
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\r\n")}\r\n`;
};

export const downloadSeatingSpreadsheet = (
  tables: Table[],
  guests: Guest[],
  filename = "seating-plan.csv",
) => {
  const blob = new Blob([buildSeatingSpreadsheetCsv(tables, guests)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
