// 盘点单演示数据补灌（seed.ts 全量灌数后的一次性追加）
const BASE = 'http://localhost:8080';

async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = null; }
  if (string(res.status)) console.log(`  ✗ POST ${path} → ${res.status}: ${text.slice(0, 160)}`);
  else console.log(`  ✓ POST ${path} → id=${data?.id ?? ''}`);
  return data;
}

function string(s: number): boolean { return s >= 300; }

async function main(): Promise<void> {
  console.log('── 库存盘点单 ──');
  const c1 = await post('/api/erp/stock-checks', {
    id: 0, no: 'CK20260908001', checkTime: '2026-09-08T10:00:00+08:00', warehouseId: 1,
    remark: '主仓月度抽盘（无差异）',
    items: [
      { productId: 1, productUnitId: 1, count: 120, systemCount: 120, diffCount: 0, remark: '' },
      { productId: 2, productUnitId: 2, count: 48, systemCount: 48, diffCount: 0, remark: '' },
    ],
  });
  const c2 = await post('/api/erp/stock-checks', {
    id: 0, no: 'CK20260912001', checkTime: '2026-09-12T14:30:00+08:00', warehouseId: 2,
    remark: '东郊仓全盘（盘盈 2 件）',
    items: [
      { productId: 3, productUnitId: 3, count: 37, systemCount: 35, diffCount: 2, remark: '找回 2 件误放退货区' },
      { productId: 4, productUnitId: 4, count: 21, systemCount: 21, diffCount: 0, remark: '' },
    ],
  });
  if (c1?.id) await post('/api/erp/stock-checks/audit', c1.id);
  if (c2?.id) await post('/api/erp/stock-checks/audit', c2.id);
}

main();
