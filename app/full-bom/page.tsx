"use client";

import { createClient } from "@/lib/supabase";
import { fetchFullBomMachineNames, fetchFullBomTreeItems, type BomTreeItem } from "@/lib/bom";
import { useEmployeeGroup } from "@/lib/groups";
import { BomStructureViewer, type BomStructureSubpart } from "@/components/bom-structure-viewer";
import { RequireGroupPrompt } from "@/components/require-group";

type SupabaseClient = ReturnType<typeof createClient>;

export default function FullBomPage() {
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
      title="Full BOM Structure Viewer"
      description="Pick a machine to view its complete BOM hierarchically, expand/collapse as needed."
      fetchMachineNames={async (supabase: SupabaseClient) => {
        const names = await fetchFullBomMachineNames(supabase);
        return names.filter((name) => allowedMachines.has(name));
      }}
      fetchSubparts={async (
        supabase: SupabaseClient,
        machineName: string,
        onProgress: (partial: BomStructureSubpart[]) => void
      ): Promise<BomStructureSubpart[]> => {
        // Full BOM is always exactly one tree per machine (no
        // source_file/multiple-subparts concept the way Modules has), so
        // this is always a single-entry list — bomId just needs to be
        // stable within one machine's render, not a real database id.
        // Full BOM can run to tens of thousands of rows, so this reports
        // progress after every fetched page rather than waiting for
        // everything before the tree renders anything at all.
        const accumulated: BomTreeItem[] = [];
        await fetchFullBomTreeItems(supabase, machineName, (pageItems) => {
          accumulated.push(...pageItems);
          onProgress([{ bomId: 0, sourceFile: "Full BOM", items: accumulated.slice() }]);
        });
        return [{ bomId: 0, sourceFile: "Full BOM", items: accumulated }];
      }}
    />
  );
}
