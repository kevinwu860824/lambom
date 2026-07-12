import * as XLSX from "xlsx-js-style";

export interface ParsedBomItem {
  part_no: string;
  description: string | null;
  qty: number | null;
  uom: string | null;
  level: number;
  parent_part_no: string | null;
  parent_path: string;
  line_no: number;
}

export interface ParsedBom {
  rootPartNo: string;
  rootDescription: string;
  items: ParsedBomItem[];
}

function collapseSpaces(value: string): string {
  return value.replace(/\s{2,}/g, " ").trim();
}

/**
 * Peels the trailing "qty uom code reference" fields off a tree-line's
 * remainder (everything after the part number), trying progressively
 * looser patterns since not every line carries the full set.
 */
function splitDescriptionAndQty(remainder: string): {
  description: string;
  qty: number | null;
  uom: string | null;
} {
  const patterns = [
    /^(.*?)\s+([\d.]+)\s+(\S+)\s+(\d{2})\s+(\S+)\s*$/,
    /^(.*?)\s+([\d.]+)\s+(\S+)\s*$/,
    /^(.*?)\s+([\d.]+)\s*$/,
  ];

  for (const pattern of patterns) {
    const match = remainder.match(pattern);
    if (match) {
      const qty = Number.parseFloat(match[2]);
      return {
        description: collapseSpaces(match[1]),
        qty: Number.isFinite(qty) ? qty : null,
        uom: match[3] ? match[3].trim() : null,
      };
    }
  }

  return { description: collapseSpaces(remainder), qty: null, uom: null };
}

/**
 * Parses a SAP-style "Order BOM Report" tree-indented .txt export.
 *
 * Depth is derived from indentation width using a stack: a line's indent
 * (the leading run of space/`|`/`-` characters before its part number)
 * is compared against the stack top to decide whether it's a child,
 * sibling, or an ancestor's sibling. This is self-consistent regardless
 * of exactly how many characters each report uses per nesting level.
 */
export function parseTxtBom(text: string): ParsedBom {
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);

  let rootLineIndex = -1;
  let rootPartNo = "";
  let rootDescription = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("|")) continue;
    if (/^-+$/.test(trimmed)) continue;

    const match = line.match(/^\s*(\S+)\s{2,}(.*)$/);
    if (match && match[1].includes("-")) {
      rootPartNo = match[1];
      rootDescription = collapseSpaces(match[2]);
      rootLineIndex = i;
      break;
    }
  }

  if (rootLineIndex === -1) {
    throw new Error("找不到根節點(第一行料號),請確認這是 BOM 報表格式的 txt 檔");
  }

  const items: ParsedBomItem[] = [
    {
      part_no: rootPartNo,
      description: rootDescription || null,
      qty: null,
      uom: null,
      level: 0,
      parent_part_no: null,
      parent_path: "",
      line_no: rootLineIndex + 1,
    },
  ];
  const stack: { indentWidth: number; partNo: string }[] = [
    { indentWidth: -1, partNo: rootPartNo },
  ];

  for (let i = rootLineIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/^[\s|-]*$/.test(line)) continue;

    const indentMatch = line.match(/^[\s|-]*/);
    const indentWidth = indentMatch ? indentMatch[0].length : 0;
    const rest = line.slice(indentWidth);
    const tokenMatch = rest.match(/^(\S+)(.*)$/);
    if (!tokenMatch) continue;

    const partNo = tokenMatch[1];
    const { description, qty, uom } = splitDescriptionAndQty(tokenMatch[2].trim());

    while (stack.length > 1 && stack[stack.length - 1].indentWidth >= indentWidth) {
      stack.pop();
    }

    const parentPartNo = stack[stack.length - 1].partNo;
    const level = stack.length;
    const parentPath = stack.map((entry) => entry.partNo).join("/");

    items.push({
      part_no: partNo,
      description: description || null,
      qty,
      uom,
      level,
      parent_part_no: parentPartNo,
      parent_path: parentPath,
      line_no: i + 1,
    });

    stack.push({ indentWidth, partNo });
  }

  return { rootPartNo, rootDescription, items };
}

/**
 * Parses the messy xlsx export where the free-text Description field's
 * embedded commas caused it to fracture across a variable number of extra
 * cells per row. Re-joining a row's cells with "," before splitting on tab
 * reconstructs the original ~52 tab-separated fields (verified against the
 * header row, which is itself one un-fractured tab-joined cell).
 */
export function parseExcelBom(buffer: ArrayBuffer): ParsedBom {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows: string[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });

  if (rows.length < 2) {
    throw new Error("Excel 檔案內容不足(至少需要表頭 + 一筆資料)");
  }

  const headerFields = rows[0].join("").split("\t").map((h) => h.trim());
  const colIndex = (name: string) => headerFields.indexOf(name);

  const materialIdx = colIndex("Material");
  const descriptionIdx = colIndex("Description");
  const uomIdx = colIndex("Uni");
  const bomQtyIdx = colIndex("BOM Qty");
  const newBuildQtyIdx = colIndex("New Build Qt");
  const levelIdx = colIndex("Level");
  const genealogyIndices = Array.from({ length: 14 }, (_, i) =>
    colIndex(`Genealogy ${String(i).padStart(2, "0")}`)
  );

  if (materialIdx === -1 || levelIdx === -1) {
    throw new Error("Excel 表頭找不到必要欄位(Material / Level),請確認檔案格式");
  }

  const items: ParsedBomItem[] = [];
  let rootPartNo = "";
  let rootDescription = "";

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (!cells || cells.every((c) => !c)) continue;

    const fields = cells.join(",").split("\t");

    const partNo = (fields[materialIdx] ?? "").trim();
    const levelRaw = (fields[levelIdx] ?? "").trim();
    const level = Number.parseInt(levelRaw, 10);
    if (!partNo || Number.isNaN(level)) continue;

    const description = collapseSpaces(fields[descriptionIdx] ?? "");
    const uom = (fields[uomIdx] ?? "").trim() || null;
    const qtyRaw = (fields[bomQtyIdx] ?? "").trim() || (fields[newBuildQtyIdx] ?? "").trim();
    const qty = qtyRaw ? Number.parseFloat(qtyRaw) : null;

    const genealogy = genealogyIndices.map((idx) =>
      idx === -1 ? "" : (fields[idx] ?? "").trim()
    );
    const ancestors = genealogy.slice(0, level).filter((v) => v.length > 0);
    const parentPartNo = ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;
    const parentPath = ancestors.join("/");

    if (level === 0) {
      rootPartNo = partNo;
      rootDescription = description;
    }

    items.push({
      part_no: partNo,
      description: description || null,
      qty: qty !== null && Number.isFinite(qty) ? qty : null,
      uom,
      level,
      parent_part_no: parentPartNo,
      parent_path: parentPath,
      line_no: r + 1,
    });
  }

  if (!rootPartNo) {
    throw new Error("找不到 Level 0 的根節點,請確認 Excel 內容");
  }

  return { rootPartNo, rootDescription, items };
}
