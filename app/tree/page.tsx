"use client";

import { createClient } from "@/lib/supabase";
import { fetchBomTreeItems, fetchMachineGroups } from "@/lib/bom";
import { useEmployeeGroup } from "@/lib/groups";
import { BomStructureViewer, type BomStructureSubpart } from "@/components/bom-structure-viewer";
import { RequireGroupPrompt } from "@/components/require-group";

type SupabaseClient = ReturnType<typeof createClient>;

export default function TreePage() {
  const { allowedMachines, employeeId, notFound, loading: groupLoading } = useEmployeeGroup();

  if (groupLoading) return null;
  if (!allowedMachines) {
    return (
      <div className="min-h-screen bg-background">
        <RequireGroupPrompt notFound={notFound} employeeId={employeeId} />
      </div>
    );
  }

  return (
    <BomStructureViewer
      title="BOM Structure Viewer"
      description="Pick a machine to view its parts hierarchically, expand/collapse as needed."
      fetchMachineNames={async (supabase: SupabaseClient) => {
        const { machineGroups } = await fetchMachineGroups(supabase);
        return machineGroups.map((g) => g.machine).filter((name) => allowedMachines.has(name));
      }}
      fetchSubparts={async (
        supabase: SupabaseClient,
        machineName: string,
        onProgress: (partial: BomStructureSubpart[]) => void
      ): Promise<BomStructureSubpart[]> => {
        const { machineGroups } = await fetchMachineGroups(supabase);
        const group = machineGroups.find((g) => g.machine === machineName);
        if (!group) return [];
        const results: BomStructureSubpart[] = [];
        for (const entry of group.subparts) {
          results.push({
            bomId: entry.bomId,
            sourceFile: entry.source_file,
            items: await fetchBomTreeItems(supabase, entry.bomId, entry.source_file),
          });
          onProgress(results.slice());
        }
        return results;
      }}
    />
  );
}
