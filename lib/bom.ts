export interface BomItem {
  part_no: string;
  description: string | null;
  qty: number | string | null;
  uom: string | null;
}

export interface BomEntry {
  bomId: number;
  source_file: string;
  machine: string;
  items: BomItem[];
  itemsLoaded: boolean;
}

export interface MachineGroup {
  machine: string;
  subparts: BomEntry[];
}

export interface AggregatedItem {
  part_no: string;
  description: string | null;
  qty: number;
  uom: string;
}

export interface CommonItem {
  part_no: string;
  description: string | null;
  qtyA: number;
  qtyB: number;
  qtyDiff: number;
  uomA: string;
  uomB: string;
  qtyMatch: boolean;
}

export interface CompareResult {
  onlyA: AggregatedItem[];
  onlyB: AggregatedItem[];
  common: CommonItem[];
}

export function toNumericQty(value: BomItem["qty"]): number {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function aggregateByPartNo(items: BomItem[]): Map<string, AggregatedItem> {
  const aggregated = new Map<string, AggregatedItem>();

  items.forEach((item) => {
    const partNo = item.part_no;
    if (!partNo) {
      return;
    }

    if (!aggregated.has(partNo)) {
      aggregated.set(partNo, {
        part_no: partNo,
        description: item.description,
        qty: 0,
        uom: item.uom ?? "",
      });
    }

    const target = aggregated.get(partNo)!;
    target.qty += toNumericQty(item.qty);

    if (!target.description && item.description) {
      target.description = item.description;
    }
    if (!target.uom && item.uom) {
      target.uom = item.uom;
    }
  });

  return aggregated;
}

export function compareBoms(bomA: BomEntry, bomB: BomEntry): CompareResult {
  const mapA = aggregateByPartNo(bomA.items);
  const mapB = aggregateByPartNo(bomB.items);

  const onlyA: AggregatedItem[] = [];
  const onlyB: AggregatedItem[] = [];
  const common: CommonItem[] = [];

  for (const [partNo, itemA] of mapA.entries()) {
    const itemB = mapB.get(partNo);
    if (!itemB) {
      onlyA.push(itemA);
    } else {
      common.push({
        part_no: partNo,
        description: itemA.description,
        qtyA: itemA.qty,
        qtyB: itemB.qty,
        qtyDiff: itemA.qty - itemB.qty,
        uomA: itemA.uom,
        uomB: itemB.uom,
        qtyMatch: itemA.qty === itemB.qty,
      });
    }
  }

  for (const [partNo, itemB] of mapB.entries()) {
    if (!mapA.has(partNo)) {
      onlyB.push(itemB);
    }
  }

  onlyA.sort((a, b) => a.part_no.localeCompare(b.part_no));
  onlyB.sort((a, b) => a.part_no.localeCompare(b.part_no));
  common.sort((a, b) => a.part_no.localeCompare(b.part_no));

  return { onlyA, onlyB, common };
}
