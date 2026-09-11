// jxc 种子数据：基础档案 → 进货单(提交) → 销货单(提交) → 验证汇总/应收应付
// 用法：node scripts/seed.mjs  （需后端已在 8080 运行）
const API = 'http://localhost:8080';

async function post(path, body) {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}
async function get(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}

// 清理上轮 ASCII 试探数据（忽略失败）
for (const id of [1, 2, 3]) {
  await fetch(`${API}/api/goods/${id}`, { method: 'DELETE' }).catch(() => {});
}

// 1. 基础档案
const goods = [];
for (const g of [
  { code: 'G001', name: '农夫山泉550ml', category: 'FOOD', spec: '550ml*24', origin: '杭州', unit: 'BOX', purchasePrice: 28.5, salePrice: 36, safetyStock: 20, remark: '' },
  { code: 'G002', name: '乐事薯片', category: 'FOOD', spec: '104g', origin: '上海', unit: 'BOTTLE', purchasePrice: 6.2, salePrice: 8.5, safetyStock: 50, remark: '' },
  { code: 'G003', name: '纯棉T恤', category: 'CLOTH', spec: 'XL', origin: '宁波', unit: 'PIECE', purchasePrice: 25, salePrice: 59, safetyStock: 30, remark: '' },
]) goods.push(await post('/api/goods', g));
const supplier = await post('/api/suppliers', {
  name: '杭州华东食品批发', shortName: '华东食品', creditCode: '91330100MA27XW1234', contact: '王经理',
  phone: '13800000001', address: '杭州市拱墅区', invoiceAddress: '杭州市拱墅区', invoicePhone: '0571-88880001',
  bankName: '工行杭州分行', bankAccount: '6222000000000001', remark: '',
});
const customer = await post('/api/customers', {
  name: '联华超市城西店', shortName: '联华城西', creditCode: '91330100MA27XW5678', contact: '李店长',
  phone: '13800000002', address: '杭州市西湖区', invoiceAddress: '杭州市西湖区', invoicePhone: '0571-88880002',
  bankName: '建行杭州分行', bankAccount: '6222000000000002', remark: '',
});
console.log(`档案: 商品×${goods.length} 供应商#${supplier.id} 客户#${customer.id}`);

// 2. 进货单 → 提交（自动生成应付款）
const purchase = await post('/api/purchase-bills', {
  billNo: 'CG20260911001', billDate: '2026-09-10T09:00:00+08:00', supplierId: supplier.id,
  contractNo: 'HT-2026-001', invoiceNo: '', logisticsCompany: '顺丰', logisticsNo: 'SF123456',
  settleMode: 'ACCOUNT', remark: '常规补货',
  items: [
    { goodsId: goods[0].id, qty: 40, price: 28.5 },
    { goodsId: goods[1].id, qty: 100, price: 6.2 },
  ],
});
await post('/api/purchase-bills/submit', String(purchase.id));
console.log(`进货单 #${purchase.id} 已提交，金额 ${purchase.totalAmount}`);

// 3. 销货单 → 提交（自动生成应收款）
const sales = await post('/api/sales-bills', {
  billNo: 'XH20260911001', billDate: '2026-09-11T14:00:00+08:00', customerId: customer.id,
  contractNo: 'HT-2026-002', invoiceNo: '', logisticsCompany: '圆通', logisticsNo: 'YT654321',
  settleMode: 'CASH', remark: '门店要货',
  items: [
    { goodsId: goods[0].id, qty: 12, price: 36 },
    { goodsId: goods[2].id, qty: 20, price: 59 },
  ],
});
await post('/api/sales-bills/submit', String(sales.id));
console.log(`销货单 #${sales.id} 已提交，金额 ${sales.totalAmount}`);

// 4. 验证
const inv = await get('/api/inventory/summary');
console.log('\n进销存汇总:');
for (const r of inv) console.log(`  ${r.goodsCode} ${r.goodsName}  进${r.inQty} 退${r.inRetQty} 销${r.outQty} 销退${r.outRetQty} 库存=${r.stock}（安全线 ${r.safetyStock}）`);
const payables = await get('/api/payables?keyword=');
console.log(`\n应付款: ${payables.map((p) => `${p.billNo} ¥${p.amount} [${p.status}]`).join('  ')}`);
const receivables = await get('/api/receivables?keyword=');
console.log(`应收款: ${receivables.map((p) => `${p.billNo} ¥${p.amount} [${p.status}]`).join('  ')}`);
console.log('\n✅ 种子数据就绪');
