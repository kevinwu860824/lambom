import * as XLSX from "xlsx-js-style";
import { strFromU8, unzipSync } from "fflate";

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
    throw new Error("Root node not found (first-row part number) — check this is a BOM report txt file");
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
    throw new Error("Excel file has insufficient content (at least a header + one data row required)");
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
    throw new Error("Required columns not found in Excel header (Material / Level) — check the file format");
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
    throw new Error("Level 0 root node not found — check the Excel content");
  }

  return { rootPartNo, rootDescription, items };
}

/**
 * Parses the flat "Part Number / Description / Indent(raw tab depth) / Qty
 * / Unit" xlsx export — unlike parseExcelBom/parseSapFieldRows, hierarchy
 * isn't given via genealogy columns; each row just carries its own
 * indentation depth as a number. Reconstructed with the same indent-stack
 * approach parseTxtBom uses for raw text indentation width, just keyed off
 * this column's value instead of counting leading whitespace.
 */
function parseIndentedRows(rows: string[][]): ParsedBom {
  if (rows.length < 2) {
    throw new Error("File has insufficient content (at least a header + one data row required)");
  }

  const headerFields = rows[0].map((h) => h.trim());
  const colIndex = (name: string) => headerFields.indexOf(name);

  const partNoIdx = colIndex("Part Number");
  const descriptionIdx = colIndex("Description");
  const indentIdx = headerFields.findIndex((h) => /^Indent/i.test(h));
  const qtyIdx = colIndex("Qty");
  const uomIdx = colIndex("Unit");

  if (partNoIdx === -1 || indentIdx === -1) {
    throw new Error("Required columns not found in header (Part Number / Indent) — check the file format");
  }

  const items: ParsedBomItem[] = [];
  const stack: { indent: number; partNo: string }[] = [];
  let rootPartNo = "";
  let rootDescription = "";

  for (let r = 1; r < rows.length; r++) {
    const fields = rows[r];
    if (!fields || fields.every((c) => !c.trim())) continue;

    const partNo = (fields[partNoIdx] ?? "").trim();
    const indentRaw = (fields[indentIdx] ?? "").trim();
    const indent = Number.parseInt(indentRaw, 10);
    if (!partNo || Number.isNaN(indent)) continue;

    const description = collapseSpaces(fields[descriptionIdx] ?? "");
    const uom = (fields[uomIdx] ?? "").trim() || null;
    const qtyRaw = (fields[qtyIdx] ?? "").trim();
    const qty = qtyRaw ? Number.parseFloat(qtyRaw) : null;

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const level = stack.length;
    const parentPartNo = stack.length > 0 ? stack[stack.length - 1].partNo : null;
    const parentPath = stack.map((entry) => entry.partNo).join("/");

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

    stack.push({ indent, partNo });
  }

  if (!rootPartNo) {
    throw new Error("Root node not found — check the file content");
  }

  return { rootPartNo, rootDescription, items };
}

export function parseIndentedExcelBom(buffer: ArrayBuffer): ParsedBom {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows: string[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
  return parseIndentedRows(rows);
}

/**
 * RFC4180-ish CSV tokenizer: comma-delimited, `"..."` quoting with `""` as
 * an escaped quote, quoted fields may contain literal commas/newlines.
 * Needed because this format's Description field legitimately contains
 * commas and is properly quoted (unlike the messy-xlsx export handled by
 * parseExcelBom, which needs a different, tab-based reconstruction hack).
 */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") {
        i++;
        continue;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Builds a ParsedBom from rows already split into fields, using the raw
 * SAP ERP field names (MATERIAL/DESCRIPTION/UOM/BOMLEVEL/NEWBUILD_QTY/
 * BOM_QTY/GENE00../GENEnn) rather than the renamed headers parseExcelBom
 * expects (Material/Description/Uni/Level/New Build Qt/BOM Qty/Genealogy
 * NN). Genealogy column GENE<nn> holds the part number at depth nn
 * (GENE00 = the level-0 root, GENE01 = the level-1 part, ...), so a row's
 * ancestors are genealogy[0..level-1] — same convention parseExcelBom's
 * "Genealogy NN" columns use, just under a different name and with the
 * column count detected from the header instead of hardcoded.
 *
 * Shared by parseCsvBom (rows from a real CSV file) and the raw-SAP-xlsx
 * fallback in parseXlsxBom (rows read positionally from the xlsx's XML,
 * since some exports of this format have unusable cell coordinates).
 */
function parseSapFieldRows(rows: string[][]): ParsedBom {
  if (rows.length < 2) {
    throw new Error("File has insufficient content (at least a header + one data row required)");
  }

  const headerFields = rows[0].map((h) => h.trim());
  const colIndex = (name: string) => headerFields.indexOf(name);

  const materialIdx = colIndex("MATERIAL");
  const descriptionIdx = colIndex("DESCRIPTION");
  const uomIdx = colIndex("UOM");
  const bomQtyIdx = colIndex("BOM_QTY");
  const newBuildQtyIdx = colIndex("NEWBUILD_QTY");
  const levelIdx = colIndex("BOMLEVEL");

  const genealogyIndices = headerFields
    .map((name, idx) => ({ level: Number.parseInt(name.match(/^GENE(\d{2,})$/)?.[1] ?? "", 10), idx }))
    .filter((entry) => !Number.isNaN(entry.level))
    .sort((a, b) => a.level - b.level)
    .map((entry) => entry.idx);

  if (materialIdx === -1 || levelIdx === -1 || genealogyIndices.length === 0) {
    throw new Error("Required columns not found in header (MATERIAL / BOMLEVEL / GENE00...) — check the file format");
  }

  const items: ParsedBomItem[] = [];
  let rootPartNo = "";
  let rootDescription = "";

  for (let r = 1; r < rows.length; r++) {
    const fields = rows[r];
    if (!fields || fields.every((c) => !c.trim())) continue;

    const partNo = (fields[materialIdx] ?? "").trim();
    const levelRaw = (fields[levelIdx] ?? "").trim();
    const level = Number.parseInt(levelRaw, 10);
    if (!partNo || Number.isNaN(level)) continue;

    const description = collapseSpaces(fields[descriptionIdx] ?? "");
    const uom = (fields[uomIdx] ?? "").trim() || null;
    const qtyRaw = (fields[bomQtyIdx] ?? "").trim() || (fields[newBuildQtyIdx] ?? "").trim();
    const qty = qtyRaw ? Number.parseFloat(qtyRaw) : null;

    const genealogy = genealogyIndices.map((idx) => (fields[idx] ?? "").trim());
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
    throw new Error("Level 0 root node not found — check the file content");
  }

  return { rootPartNo, rootDescription, items };
}

/**
 * Parses a raw SAP BOM export CSV (see parseSapFieldRows for the field
 * naming convention).
 */
export function parseCsvBom(text: string): ParsedBom {
  return parseSapFieldRows(parseCsvRows(text.replace(/^﻿/, "")));
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, "&");
}

function parseSharedStrings(xml: string): string[] {
  const items: string[] = [];
  const siRegex = /<si>([\s\S]*?)<\/si>/g;
  let siMatch: RegExpExecArray | null;
  while ((siMatch = siRegex.exec(xml))) {
    const texts = Array.from(siMatch[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((m) =>
      decodeXmlEntities(m[1])
    );
    items.push(texts.join(""));
  }
  return items;
}

/**
 * Reads an xlsx worksheet's rows *positionally* — the Nth `<c>` element
 * inside a `<row>` is treated as column N, in document order — instead of
 * trusting each cell's `r="..."` coordinate attribute.
 *
 * Some SAP-export tools write invalid coordinates there (raw column
 * numbers concatenated with the row number, e.g. `r="101"` for column 10
 * row 1, instead of the required column-letter form like `J1`). Desktop
 * Excel/Numbers silently tolerate this by falling back to positional
 * order, but xlsx-js-style (and the OOXML spec) do not, so a normal
 * XLSX.read() on these files silently comes back with zero usable cells.
 * This positional reader works whether or not the coordinates are valid.
 */
function parseSheetRowsLenient(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(xml))) {
    const cells: string[] = [];
    const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      const attrs = cellMatch[1];
      const inner = cellMatch[2] ?? "";
      const type = attrs.match(/\st="([^"]*)"/)?.[1] ?? "n";

      let value = "";
      if (type === "inlineStr") {
        const isBody = inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? "";
        value = Array.from(isBody.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g))
          .map((m) => decodeXmlEntities(m[1]))
          .join("");
      } else {
        const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const decoded = raw !== undefined ? decodeXmlEntities(raw) : "";
        if (type === "s") {
          const idx = Number.parseInt(decoded, 10);
          value = Number.isNaN(idx) ? "" : (sharedStrings[idx] ?? "");
        } else {
          value = decoded;
        }
      }
      cells.push(value);
    }

    rows.push(cells);
  }

  return rows;
}

/** Resolves the first worksheet's zip-entry path via workbook.xml + its rels, falling back to the common default path if either is missing/unparseable. */
function resolveFirstSheetPath(files: Record<string, Uint8Array>): string {
  const fallback = "xl/worksheets/sheet1.xml";
  const workbookXml = files["xl/workbook.xml"] ? strFromU8(files["xl/workbook.xml"]) : "";
  const relsXml = files["xl/_rels/workbook.xml.rels"]
    ? strFromU8(files["xl/_rels/workbook.xml.rels"])
    : "";

  const rId = workbookXml.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  if (!rId) return fallback;

  const target = relsXml.match(
    new RegExp(`<Relationship\\b[^>]*\\bId="${rId}"[^>]*\\bTarget="([^"]+)"`)
  )?.[1];
  if (!target) return fallback;

  return `xl/${target.replace(/^\/?xl\//, "")}`;
}

function readXlsxRowsLenient(buffer: ArrayBuffer): string[][] {
  const files = unzipSync(new Uint8Array(buffer));

  const sheetPath = resolveFirstSheetPath(files);
  const sheetXml = files[sheetPath] ? strFromU8(files[sheetPath]) : null;
  if (!sheetXml) {
    throw new Error("No worksheet data found in the xlsx file (xl/worksheets/...)");
  }

  const sharedStrings = files["xl/sharedStrings.xml"]
    ? parseSharedStrings(strFromU8(files["xl/sharedStrings.xml"]))
    : [];

  return parseSheetRowsLenient(sheetXml, sharedStrings);
}

/**
 * Entry point for .xlsx/.xls uploads — auto-detects which of the known xlsx
 * variants a file is:
 *  1. The "renamed header" messy export (Material/Description/Uni/Level/
 *     Genealogy NN, comma-fractured cells) → parseExcelBom, unchanged.
 *  2. The flat "Part Number/Description/Indent(raw tab depth)/Qty/Unit"
 *     export, hierarchy given as a per-row depth number rather than
 *     genealogy columns → parseIndentedExcelBom.
 *  3. The raw-SAP-named export (MATERIAL/.../GENE00..), which sometimes
 *     also has the invalid-coordinate bug described on parseSheetRowsLenient
 *     → read positionally and fed through the same field mapping as the CSV
 *     format.
 * Tries (1) and (2) first since they're a normal, fast XLSX.read(); only
 * unzips by hand for (3) when neither's expected headers are found.
 */
export function parseXlsxBom(buffer: ArrayBuffer): ParsedBom {
  try {
    return parseExcelBom(buffer);
  } catch (primaryErr) {
    try {
      return parseIndentedExcelBom(buffer);
    } catch {
      try {
        return parseSapFieldRows(readXlsxRowsLenient(buffer));
      } catch {
        throw primaryErr instanceof Error ? primaryErr : new Error(String(primaryErr));
      }
    }
  }
}

/**
 * Parses one sheet of the "<SO>_modules.xlsx" produced by the desktop SAP
 * downloader's merge_module_files (see desktop/sap-downloader/
 * fid_downloader_cli.py) — columns Part Number/Description/Level/Path/Qty/
 * Unit, where Path is already a "/"-joined chain of ancestor part numbers
 * (not descriptions), so unlike the other formats no genealogy/indent-stack
 * reconstruction is needed: level and parent path are given directly.
 */
function parseModuleSheetRows(rows: string[][]): ParsedBom {
  if (rows.length < 2) {
    throw new Error("This sheet has no data");
  }

  const items: ParsedBomItem[] = [];
  let rootPartNo = "";
  let rootDescription = "";

  for (let r = 1; r < rows.length; r++) {
    const [partNo, description, levelRaw, path, qtyRaw, uom] = rows[r] ?? [];
    if (!partNo) continue;

    const level = Number.parseInt(levelRaw ?? "", 10);
    if (Number.isNaN(level)) continue;

    const qty = qtyRaw ? Number.parseFloat(qtyRaw) : null;
    const parentPath = path ?? "";
    const ancestors = parentPath ? parentPath.split("/") : [];
    const parentPartNo = ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;

    if (level === 0) {
      rootPartNo = partNo;
      rootDescription = description ?? "";
    }

    items.push({
      part_no: partNo,
      description: description || null,
      qty: qty !== null && Number.isFinite(qty) ? qty : null,
      uom: uom || null,
      level,
      parent_part_no: parentPartNo,
      parent_path: parentPath,
      line_no: r + 1,
    });
  }

  if (!rootPartNo) {
    throw new Error("Level 0 root node not found");
  }

  return { rootPartNo, rootDescription, items };
}

/**
 * Reads every sheet of a merged Modules workbook — each sheet is one module
 * (its own independent BOM tree), matching how the app already treats a
 * machine's separate uploaded files as separate subparts.
 */
export function parseModulesWorkbook(buffer: ArrayBuffer): { sheetName: string; parsed: ParsedBom }[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows: string[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: "",
    });
    try {
      return { sheetName, parsed: parseModuleSheetRows(rows) };
    } catch (err) {
      throw new Error(
        `Failed to parse sheet "${sheetName}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });
}
