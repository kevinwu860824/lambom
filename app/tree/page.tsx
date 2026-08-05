"use client";

import { createClient } from "@/lib/supabase";
import { fetchBomTreeItems, fetchMachineGroups } from "@/lib/bom";
import { BomStructureViewer, type BomStructureSubpart } from "@/components/bom-structure-viewer";

type SupabaseClient = ReturnType<typeof createClient>;

export default function TreePage() {
  return (
    <BomStructureViewer
      title="BOM Structure Viewer"
      description="Pick a machine to view its parts hierarchically, expand/collapse as needed."
      fetchMachineNames={async (supabase: SupabaseClient) => {
        const { machineGroups } = await fetchMachineGroups(supabase);
        return machineGroups.map((g) => g.machine);
      }}
      fetchSubparts={async (supabase: SupabaseClient, machineName: string): Promise<BomStructureSubpart[]> => {
        const { machineGroups } = await fetchMachineGroups(supabase);
        const group = machineGroups.find((g) => g.machine === machineName);
        if (!group) return [];
        return Promise.all(
          group.subparts.map(async (entry) => ({
            bomId: entry.bomId,
            sourceFile: entry.source_file,
            items: await fetchBomTreeItems(supabase, entry.bomId, entry.source_file),
          }))
        );
      }}
    />
  );
}
