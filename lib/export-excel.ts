import * as XLSX from "xlsx-js-style";
import type { AggregatedItem, BomSummary, CompareResult } from "@/lib/bom";

type CellValue = string | number;
type CellStyle = Record<string, unknown>;

const HEADER_FILL = "6A7885";
const HEADER_FONT_COLOR = "FFFFFF";
const STRIPE_FILL = "F2F4F5";
const BORDER_COLOR = "D8DEE3";

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

function bodyStyle(isStripe: boolean): CellStyle {
  return {
    fill: isStripe ? { fgColor: { rgb: STRIPE_FILL } } : undefined,
    border: thinBorder(BORDER_COLOR),
    alignment: { vertical: "center" },
  };
}

function applyStyles(sheet: XLSX.WorkSheet, rows: CellValue[][], headerRowCount: number) {
  const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);

  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < colCount; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (!sheet[ref]) continue;
      sheet[ref].s = r < headerRowCount ? headerStyle() : bodyStyle((r - headerRowCount) % 2 === 1);
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

function buildSheet(rows: CellValue[][], headerRowCount: number): XLSX.WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = autoColWidths(rows);
  applyStyles(sheet, rows, headerRowCount);
  return sheet;
}

function buildPartSheet(items: AggregatedItem[]): XLSX.WorkSheet {
  const rows: CellValue[][] = [
    ["料號", "描述", "Qty", "Unit"],
    ...items.map((i) => [i.part_no, i.description ?? "", i.qty ?? "", i.uom ?? ""]),
  ];
  return buildSheet(rows, 1);
}

function safeFilenamePart(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

export function exportCompareToExcel(
  summaryA: BomSummary,
  summaryB: BomSummary,
  result: CompareResult,
  filteredOnlyA: AggregatedItem[],
  filteredOnlyB: AggregatedItem[]
) {
  const qtyMismatchCount = result.common.filter((item) => !item.qtyMatch).length;

  const summaryRows: CellValue[][] = [
    ["項目", "內容"],
    ["機台 A", summaryA.machine],
    ["子項 A", summaryA.source_file],
    ["明細 A", summaryA.itemCount],
    ["唯一料號 A", summaryA.uniqueCount],
    ["機台 B", summaryB.machine],
    ["子項 B", summaryB.source_file],
    ["明細 B", summaryB.itemCount],
    ["唯一料號 B", summaryB.uniqueCount],
    ["共同料號", result.common.length],
    ["僅 A", result.onlyA.length],
    ["僅 B", result.onlyB.length],
    ["Qty 不一致", qtyMismatchCount],
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSheet(summaryRows, 1), "比對摘要");
  XLSX.utils.book_append_sheet(wb, buildPartSheet(filteredOnlyA), "僅存在於 A");
  XLSX.utils.book_append_sheet(wb, buildPartSheet(filteredOnlyB), "僅存在於 B");

  const filename = `BOM比對_${safeFilenamePart(summaryA.machine)}_vs_${safeFilenamePart(summaryB.machine)}.xlsx`;
  XLSX.writeFile(wb, filename);
}
