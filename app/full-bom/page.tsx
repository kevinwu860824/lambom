"use client";

import { createClient } from "@/lib/supabase";
import { fetchFullBomMachineNames, fetchFullBomTreeItems } from "@/lib/bom";
import { BomStructureViewer, type BomStructureSubpart } from "@/components/bom-structure-viewer";

type SupabaseClient = ReturnType<typeof createClient>;

export default function FullBomPage() {
  return (
    <BomStructureViewer
      title="Full BOM Structure Viewer"
      description="Pick a machine to view its complete BOM hierarchically, expand/collapse as needed."
      fetchMachineNames={(supabase: SupabaseClient) => fetchFullBomMachineNames(supabase)}
      fetchSubparts={async (supabase: SupabaseClient, machineName: string): Promise<BomStructureSubpart[]> => {
        const items = await fetchFullBomTreeItems(supabase, machineName);
        // Full BOM is always exactly one tree per machine (no
        // source_file/multiple-subparts concept the way Modules has), so
        // this is always a single-entry list — bomId just needs to be
        // stable within one machine's render, not a real database id.
        return [{ bomId: 0, sourceFile: "Full BOM", items }];
      }}
    />
  );
}
