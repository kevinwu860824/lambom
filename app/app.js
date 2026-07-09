let bomData = [];
let machineGroups = [];

const supabaseUrl = 'https://bybdmdevlmcbmzvgaimu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5YmRtZGV2bG1jYm16dmdhaW11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1NTM5NTYsImV4cCI6MjA5OTEyOTk1Nn0.wCOcSIvgu6zbM47iip_ymH2QCWyt_yLqnqveC6k2Ykc';

function getSupabaseHeaders() {
  return {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };
}

function buildTable(items) {
  if (!items.length) {
    return '<p class="empty">沒有資料</p>';
  }

  const rows = items.map(item => `
    <tr>
      <td>${item.part_no}</td>
      <td>${item.description}</td>
      <td>${item.qty ?? "-"}</td>
      <td>${item.uom ?? ""}</td>
    </tr>
  `).join('');

  return `
    <table>
      <thead>
        <tr>
          <th>料號</th>
          <th>描述</th>
          <th>Qty</th>
          <th>Unit</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function toNumericQty(value) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function aggregateByPartNo(items) {
  const aggregated = new Map();

  items.forEach(item => {
    const partNo = item.part_no;
    if (!partNo) {
      return;
    }

    if (!aggregated.has(partNo)) {
      aggregated.set(partNo, {
        part_no: partNo,
        description: item.description,
        qty: 0,
        uom: item.uom ?? '',
      });
    }

    const target = aggregated.get(partNo);
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

function compareBoms(bomA, bomB) {
  const mapA = aggregateByPartNo(bomA.items);
  const mapB = aggregateByPartNo(bomB.items);

  const onlyA = [];
  const onlyB = [];
  const common = [];

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

function refreshSubparts(side) {
  const machineSelectId = side === 'A' ? 'machineA' : 'machineB';
  const subpartSelectId = side === 'A' ? 'subpartA' : 'subpartB';
  const machine = document.getElementById(machineSelectId).value;
  const group = machineGroups.find(item => item.machine === machine) || machineGroups[0];
  const subparts = group ? group.subparts : [];
  const subpartSelect = document.getElementById(subpartSelectId);

  subpartSelect.innerHTML = subparts
    .map(item => `<option value="${item.source_file}">${item.source_file}</option>`)
    .join('');
  subpartSelect.value = subparts[0]?.source_file ?? '';
}

function getSelectedBom(side) {
  const machineSelectId = side === 'A' ? 'machineA' : 'machineB';
  const subpartSelectId = side === 'A' ? 'subpartA' : 'subpartB';
  const machine = document.getElementById(machineSelectId).value;
  const sourceFile = document.getElementById(subpartSelectId).value;

  return bomData.find(item => item.machine === machine && item.source_file === sourceFile) || null;
}

async function loadData() {
  const [machinesRes, itemsRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/bom_machines?select=id,machine_name,source_file`, {
      headers: getSupabaseHeaders(),
    }),
    fetch(`${supabaseUrl}/rest/v1/bom_items?select=bom_id,part_no,description,qty,uom`, {
      headers: getSupabaseHeaders(),
    }),
  ]);

  if (!machinesRes.ok || !itemsRes.ok) {
    throw new Error(`Supabase request failed (machines: ${machinesRes.status}, items: ${itemsRes.status})`);
  }

  const [machines, items] = await Promise.all([machinesRes.json(), itemsRes.json()]);
  const itemsByBomId = new Map();

  items.forEach(item => {
    const bomId = String(item.bom_id);
    if (!itemsByBomId.has(bomId)) {
      itemsByBomId.set(bomId, []);
    }
    itemsByBomId.get(bomId).push(item);
  });

  bomData = machines.map(machine => ({
    source_file: machine.source_file,
    machine: machine.machine_name,
    items: itemsByBomId.get(String(machine.id)) || [],
  }));

  if (!bomData.length) {
    throw new Error('Supabase returned no BOM records.');
  }

  const grouped = new Map();
  bomData.forEach(item => {
    if (!grouped.has(item.machine)) {
      grouped.set(item.machine, []);
    }
    grouped.get(item.machine).push(item);
  });

  machineGroups = Array.from(grouped.entries()).map(([machine, subparts]) => ({ machine, subparts }));

  const machineA = document.getElementById('machineA');
  const machineB = document.getElementById('machineB');
  const machineOptions = machineGroups
    .map(group => `<option value="${group.machine}">${group.machine}</option>`)
    .join('');

  machineA.innerHTML = machineOptions;
  machineB.innerHTML = machineOptions;

  machineA.value = machineGroups[0]?.machine ?? '';
  machineB.value = machineGroups[1]?.machine ?? machineGroups[0]?.machine ?? '';

  refreshSubparts('A');
  refreshSubparts('B');
}

function renderSummary(bomA, bomB, result) {
  const uniqueA = aggregateByPartNo(bomA.items).size;
  const uniqueB = aggregateByPartNo(bomB.items).size;
  const qtyMismatch = result.common.filter(item => !item.qtyMatch).length;

  const summary = document.getElementById('summary');
  summary.innerHTML = `
    <h2>比對摘要</h2>
    <p><strong>${bomA.machine}</strong> / ${bomA.source_file}：明細 ${bomA.items.length} 項、唯一料號 ${uniqueA} 項</p>
    <p><strong>${bomB.machine}</strong> / ${bomB.source_file}：明細 ${bomB.items.length} 項、唯一料號 ${uniqueB} 項</p>
    <p>共同料號：${result.common.length}</p>
    <p>僅 A：${result.onlyA.length}</p>
    <p>僅 B：${result.onlyB.length}</p>
    <p>共同料號中 Qty 不一致：${qtyMismatch}</p>
  `;
}

function renderTables(result) {
  document.getElementById('onlyA').innerHTML = buildTable(result.onlyA);
  document.getElementById('onlyB').innerHTML = buildTable(result.onlyB);

  const commonHtml = result.common.length ? `
    <table>
      <thead>
        <tr>
          <th>料號</th>
          <th>描述</th>
          <th>A Qty</th>
          <th>B Qty</th>
          <th>差值(A-B)</th>
        </tr>
      </thead>
      <tbody>
        ${result.common.map(item => `
          <tr>
            <td>${item.part_no}</td>
            <td>${item.description}</td>
            <td>${item.qtyA ?? '-'}</td>
            <td>${item.qtyB ?? '-'}</td>
            <td>${item.qtyDiff}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : '<p class="empty">沒有共同項目</p>';

  document.getElementById('common').innerHTML = commonHtml;
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadData();
  } catch (error) {
    document.getElementById('summary').innerHTML = `<p class="empty">載入 Supabase 失敗：${error.message}</p>`;
    document.getElementById('onlyA').innerHTML = '<p class="empty">沒有資料</p>';
    document.getElementById('onlyB').innerHTML = '<p class="empty">沒有資料</p>';
    document.getElementById('common').innerHTML = '<p class="empty">沒有資料</p>';
    return;
  }

  document.getElementById('machineA').addEventListener('change', () => refreshSubparts('A'));
  document.getElementById('machineB').addEventListener('change', () => refreshSubparts('B'));

  document.getElementById('compareBtn').addEventListener('click', () => {
    const bomA = getSelectedBom('A');
    const bomB = getSelectedBom('B');
    if (!bomA || !bomB) return;

    const result = compareBoms(bomA, bomB);
    renderSummary(bomA, bomB, result);
    renderTables(result);
  });

  document.getElementById('compareBtn').click();
});
