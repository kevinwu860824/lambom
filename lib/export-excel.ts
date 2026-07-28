import * as XLSX from "xlsx-js-style";
import {
  buildKeyPartDisplayRows,
  type AggregatedItem,
  type BomSummary,
  type CompareResult,
  type KeyPartInfo,
} from "@/lib/bom";

type CellValue = string | number;
type CellStyle = Record<string, unknown>;

const HEADER_FILL = "6A7885";
const HEADER_FONT_COLOR = "FFFFFF";
const STRIPE_FILL = "F2F4F5";
const BORDER_COLOR = "D8DEE3";
const RENAMED_FONT_COLOR = "DC2626";

export interface KeyPartExportInfo {
  keyPartInfoA: Map<string, KeyPartInfo>;
  keyPartInfoB: Map<string, KeyPartInfo>;
  renameInfoA: Map<string, string>;
  renameInfoB: Map<string, string>;
  renameRankB: Map<string, number>;
}

function thinBorder(color: string) {
  return {
    top: { style: "thin", color: { rgb: color } },
    bottom: { style: "thin", color: { rgb: color } },
    left: { style: "thin", color: { rgb: color } },
    right: { style: "thin", color: { rgb: color } },
  };
}

function headerStyle(): CellStyle {
  return {
    font: { bold: true, color: { rgb: HEADER_FONT_COLOR } },
    fill: { fgColor: { rgb: HEADER_FILL } },
    alignment: { horizontal: "center", vertical: "center" },
    border: thinBorder(BORDER_COLOR),
  };
}

function bodyStyle(isStripe: boolean, isRenamed: boolean): CellStyle {
  return {
    font: isRenamed ? { color: { rgb: RENAMED_FONT_COLOR } } : undefined,
    fill: isStripe ? { fgColor: { rgb: STRIPE_FILL } } : undefined,
    border: thinBorder(BORDER_COLOR),
    alignment: { vertical: "center" },
  };
}

function applyStyles(
  sheet: XLSX.WorkSheet,
  rows: CellValue[][],
  headerRowCount: number,
  renamedRows: Set<number> = new Set()
) {
  const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);

  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < colCount; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (!sheet[ref]) continue;
      sheet[ref].s =
        r < headerRowCount
          ? headerStyle()
          : bodyStyle((r - headerRowCount) % 2 === 1, renamedRows.has(r));
    }
  }
}

function autoColWidths(rows: CellValue[][]): { wch: number }[] {
  const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const widths = new Array(colCount).fill(6);

  for (const row of rows) {
    row.forEach((cell, c) => {
      const len = cell === null || cell === undefined ? 0 : String(cell).length;
      widths[c] = Math.min(Math.max(widths[c], len + 2), 60);
    });
  }

  return widths.map((wch) => ({ wch }));
}

function buildSheet(
  rows: CellValue[][],
  headerRowCount: number,
  renamedRows?: Set<number>
): XLSX.WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = autoColWidths(rows);
  applyStyles(sheet, rows, headerRowCount, renamedRows);
  return sheet;
}

function buildPartSheet(
  items: AggregatedItem[],
  keyPartInfo: Map<string, KeyPartInfo>,
  renameInfo: Map<string, string>,
  renameRank?: Map<string, number>
): XLSX.WorkSheet {
  const displayRows = buildKeyPartDisplayRows(items, keyPartInfo, renameInfo, renameRank);

  const rows: CellValue[][] = [
    ["Part No.", "Description", "Qty", "Unit", "Custom Name", "Subparts", "Possibly Renamed"],
    ...displayRows.map(({ item, keyPartInfo: info, renameText }) => [
      item.part_no,
      item.description ?? "",
      item.qty ?? "",
      item.uom ?? "",
      info?.customName ?? "",
      info && info.subparts.length > 0 ? info.subparts.join(", ") : "",
      renameText ?? "",
    ]),
  ];

  const renamedRows = new Set<number>();
  displayRows.forEach((row, i) => {
    if (row.renameText) renamedRows.add(i + 1); // +1: header occupies row 0
  });

  return buildSheet(rows, 1, renamedRows);
}

function safeFilenamePart(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

export function exportCompareToExcel(
  summaryA: BomSummary,
  summaryB: BomSummary,
  result: CompareResult,
  filteredOnlyA: AggregatedItem[],
  filteredOnlyB: AggregatedItem[],
  keyPartExportInfo: KeyPartExportInfo
) {
  const { keyPartInfoA, keyPartInfoB, renameInfoA, renameInfoB, renameRankB } = keyPartExportInfo;
  const qtyMismatchCount = result.common.filter((item) => !item.qtyMatch).length;

  const summaryRows: CellValue[][] = [
    ["Item", "Value"],
    ["Machine A", summaryA.machine],
    ["Subpart A", summaryA.source_file],
    ["Detail Items A", summaryA.itemCount],
    ["Unique Parts A", summaryA.uniqueCount],
    ["Machine B", summaryB.machine],
    ["Subpart B", summaryB.source_file],
    ["Detail Items B", summaryB.itemCount],
    ["Unique Parts B", summaryB.uniqueCount],
    ["Common Parts", result.common.length],
    ["A Only", result.onlyA.length],
    ["B Only", result.onlyB.length],
    ["Qty Mismatch", qtyMismatchCount],
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSheet(summaryRows, 1), "Comparison Summary");
  XLSX.utils.book_append_sheet(
    wb,
    buildPartSheet(filteredOnlyA, keyPartInfoA, renameInfoA),
    "Only in A"
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildPartSheet(filteredOnlyB, keyPartInfoB, renameInfoB, renameRankB),
    "Only in B"
  );

  const filename = `BOM_Comparison_${safeFilenamePart(summaryA.machine)}_vs_${safeFilenamePart(summaryB.machine)}.xlsx`;
  XLSX.writeFile(wb, filename);
}
