// One-time migration: F22 VXT Daily Passdown_2026.xlsx -> passdown_entries / passdown_updates.
//
// Usage (run scripts/passdown-schema.sql in the Supabase SQL Editor first):
//   node --env-file=.env.local scripts/migrate-passdown.js --dry-run
//   node --env-file=.env.local scripts/migrate-passdown.js --limit-days=30
//   node --env-file=.env.local scripts/migrate-passdown.js
//
// Safe to re-run: passdown_entries is upserted on (entry_date, tool_id, module),
// and this script's own historical-import notes (tagged "[歷史匯入]") are
// deleted and re-inserted per batch rather than duplicated. Any note added by
// a real person through the app (no such tag) is never touched.

const XLSX = require("xlsx-js-style");
const { createClient } = require("@supabase/supabase-js");

const EXCEL_PATH =
  process.env.PASSDOWN_XLSX_PATH ?? "/Users/j.c.wu/development/Passdown Tool/F22 VXT Daily Passdown_2026.xlsx";
const SHEET_NAME = "F22 VXT PassDown";
const IMPORT_TAG = "[歷史匯入]";
const BATCH_SIZE = 500;

const dryRun = process.argv.includes("--dry-run");
const limitDaysArg = process.argv.find((a) => a.startsWith("--limit-days="));
const limitDays = limitDaysArg ? Number(limitDaysArg.split("=")[1]) : undefined;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  console.error("Run with: node --env-file=.env.local scripts/migrate-passdown.js");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

function excelSerialToISODate(serial) {
  const utcDays = Math.floor(serial - 25569);
  return new Date(utcDays * 86400 * 1000).toISOString().slice(0, 10);
}

function normalizeStatus(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (s === "up") return "up";
  if (s === "down") return "down";
  if (s.startsWith("mon")) return "monitor";
  return "other";
}

function cell(row, key) {
  const v = row[key];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

async function main() {
  const workbook = XLSX.readFile(EXCEL_PATH);
  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" not found in ${EXCEL_PATH}`);
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  console.log(`Read ${rawRows.length} rows from "${SHEET_NAME}"`);

  // One group per (entry_date, tool_id, module) — the same grain as the
  // unique constraint on passdown_entries. Most groups have exactly one
  // source row; a handful (~0.5%) have several, which the sheet accumulated
  // by people re-using/copying a row instead of creating a new one — every
  // source row is preserved as its own passdown_updates note either way, so
  // nothing is lost by merging them into one entry.
  const groups = new Map();
  for (const row of rawRows) {
    const toolId = cell(row, "Tool ID");
    const module = cell(row, "Module");
    const dateVal = row["Date"];
    if (!toolId || !module || typeof dateVal !== "number") continue;
    const entryDate = excelSerialToISODate(dateVal);
    const key = `${entryDate}|${toolId}|${module}`;
    if (!groups.has(key)) {
      groups.set(key, { entryDate, toolId, module, product: cell(row, "Product"), rows: [] });
    }
    groups.get(key).rows.push(row);
  }

  let allGroups = [...groups.values()].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  console.log(`Grouped into ${allGroups.length} unique (date, tool, module) entries`);

  if (limitDays) {
    const days = [...new Set(allGroups.map((g) => g.entryDate))].sort();
    const cutoffDays = new Set(days.slice(-limitDays));
    allGroups = allGroups.filter((g) => cutoffDays.has(g.entryDate));
    console.log(`--limit-days=${limitDays}: migrating ${allGroups.length} entries in the most recent ${limitDays} days`);
  }

  if (dryRun) {
    const noteCount = allGroups.reduce(
      (sum, g) => sum + g.rows.filter((r) => cell(r, "Activities & Planning") || cell(r, "Owner")).length,
      0
    );
    console.log(`[dry-run] Would upsert ${allGroups.length} entries and ~${noteCount} historical update notes.`);
    return;
  }

  let migratedEntries = 0;
  let migratedNotes = 0;

  for (let i = 0; i < allGroups.length; i += BATCH_SIZE) {
    const batch = allGroups.slice(i, i + BATCH_SIZE);

    const entryRows = batch.map((g) => {
      const last = g.rows[g.rows.length - 1];
      const statusRaw = cell(last, "Status");
      return {
        entry_date: g.entryDate,
        tool_id: g.toolId,
        product: g.product,
        module: g.module,
        status: normalizeStatus(statusRaw),
        status_raw: statusRaw,
        problem_statement: cell(last, "Problem Statement"),
        remark: cell(last, "Remark / ES Ticket"),
      };
    });

    const { data: inserted, error } = await supabase
      .from("passdown_entries")
      .upsert(entryRows, { onConflict: "entry_date,tool_id,module" })
      .select("id,entry_date,tool_id,module");
    if (error) throw new Error(`Batch at row ${i}: ${error.message}`);
    migratedEntries += inserted?.length ?? 0;

    const idByKey = new Map((inserted ?? []).map((r) => [`${r.entry_date}|${r.tool_id}|${r.module}`, r.id]));
    const entryIds = [...idByKey.values()];

    const noteRows = [];
    for (const g of batch) {
      const entryId = idByKey.get(`${g.entryDate}|${g.toolId}|${g.module}`);
      if (!entryId) continue;
      for (const row of g.rows) {
        const activities = cell(row, "Activities & Planning");
        const owner = cell(row, "Owner");
        if (!activities && !owner) continue;
        const note = [IMPORT_TAG, owner ? `Owner: ${owner}` : null, activities].filter(Boolean).join("\n");
        noteRows.push({ entry_id: entryId, person_id: null, shift: null, note });
      }
    }

    if (entryIds.length > 0) {
      const { error: deleteError } = await supabase
        .from("passdown_updates")
        .delete()
        .in("entry_id", entryIds)
        .ilike("note", `${IMPORT_TAG}%`);
      if (deleteError) throw new Error(`Batch at row ${i} (clearing old import notes): ${deleteError.message}`);
    }

    if (noteRows.length > 0) {
      const { error: noteError } = await supabase.from("passdown_updates").insert(noteRows);
      if (noteError) throw new Error(`Batch at row ${i} (notes): ${noteError.message}`);
      migratedNotes += noteRows.length;
    }

    console.log(`  ...${Math.min(i + BATCH_SIZE, allGroups.length)}/${allGroups.length} entries migrated`);
  }

  console.log(`Done. ${migratedEntries} entries, ${migratedNotes} historical update notes.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
