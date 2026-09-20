/**
 * 中文演示数据灌入：对运行中的 yudao 后端(默认 http://localhost:8080) POST 全量业务数据。
 * 用法: tsx scripts/seed.ts [BASE_URL]
 * 数据组织成闭环：产品/仓库/结算账户 → 库存；采购单/入库/退货/付款；销售单/出库/退货/收款；CRM 线索/客户/商机/合同/回款。
 * 注意：代码生成未产出 ERP 供应商/客户列表页（无对应接口），单据上直接使用 1..n 整数 FK。
 */
let BASE = 'http://localhost:8080';
if (process.argv[2]) BASE = process.argv[2].replace(/\/$/, '');
let pass = 0;
let fail = 0;
// M11 鉴权：除 /api/auth/** 外全部接口要求 Bearer token（先注册/登录管理员）
let TOKEN = '';

async function post(path: string, body: unknown): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    fail++;
    console.error(`  ✗ POST ${path} → ${res.status}: ${text.slice(0, 200)}`);
    return null;
  }
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  pass++;
  const id = json && typeof json === 'object' ? json.id ?? json : '';
  console.log(`  ✓ POST ${path} → id=${id}`);
  return json;
}

const t = async (label: string, fn: () => Promise<void>) => {
  console.log(`\n── ${label} ──`);
  await fn();
};

/** DateTime 字段收 ZonedDateTime：必须带时区偏移 */
const $ = (s: string): string => `${s}+08:00`;

async function main(): Promise<void> {
  // ================= M11 鉴权：管理员注册 + 登录拿 token（唯一免 token 入口是 /api/auth/**） =================
  await t('鉴权（注册 admin / 登录拿 token）', async () => {
    // 幂等：已存在（重跑）不算失败
    const reg = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '123456', nickname: '管理员' }),
    });
    const regText = await reg.text();
    console.log(`  ✓ 注册 admin → ${reg.status}${reg.ok ? '' : `（${regText.slice(0, 60)}，重跑忽略）`}`);
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '123456' }),
    });
    if (!loginRes.ok) {
      fail++;
      console.error(`  ✗ 登录失败 → ${loginRes.status}: ${await loginRes.text()}`);
      process.exit(1);
    }
    const lr = await loginRes.json();
    TOKEN = String(lr?.token ?? '');
    console.log(`  ✓ 登录成功（token 长度 ${TOKEN.length}）`);
  });

  // 未带 token 访问受保护接口应 401（鉴权链路自检）
  const probe = await fetch(`${BASE}/api/erp/products`);
  console.log(`  ✓ 无 token 探针 /api/erp/products → ${probe.status}${probe.status === 401 ? '（401 ✓ 鉴权生效）' : ''}`);

  // ================= 系统用户（负责人/销售员引用） =================
  const users = ['王建国', '李国华', '张云飞', '刘思远'];
  for (const [i, nickname] of users.entries()) {
    await post(`/api/users`, { username: 'user' + (i + 1), nickname });
  }

  // ================= ERP 基础资料 =================
  const catIds: Record<string, number> = {};
  await t('产品分类', async () => {
    const names = ['办公设备', '数码配件', '文具耗材'];
    for (const [i, name] of names.entries()) {
      const c = await post('/api/erp/product-categories', { name, sort: i + 1, status: 'ENABLE' });
      if (c?.id) catIds[name] = c.id;
    }
  });

  const unitIds: Record<string, number> = {};
  await t('产品单位', async () => {
    for (const name of ['台', '件', '盒', '个']) {
      const u = await post('/api/erp/product-units', { name, status: 'ENABLE' });
      if (u?.id) unitIds[name] = u.id;
    }
  });

  const productIds: Record<string, number> = {};
  await t('产品', async () => {
    const rows: Array<[string, string, string, number, number]> = [
      ['联想 拯救者 Y9000P 笔记本电脑', '办公设备', '台', 6499, 7299],
      ['戴尔 U2723QE 4K 显示器', '办公设备', '台', 2899, 3299],
      ['罗技 MX Master 3S 无线鼠标', '数码配件', '个', 449, 499],
      ['绿联 氮化镓 65W 充电器', '数码配件', '个', 129, 169],
      ['金士顿 DDR5 32G 内存条', '数码配件', '个', 379, 429],
      ['得力 A4 复印纸 80g', '文具耗材', '盒', 108, 120],
      ['晨光 中性笔 0.5mm(12支)', '文具耗材', '盒', 15, 18],
    ];
    for (const [name, cn, un, purchasePrice, salePrice] of rows) {
      const p = await post('/api/erp/products', {
        name, categoryId: catIds[cn], unitId: unitIds[un], purchasePrice, salePrice,
        minPrice: Math.round(purchasePrice * 0.9), barCode: '690' + String(1000000000 + Object.keys(productIds).length), status: 'ENABLE', remark: `主营产品-${name}`,
      });
      if (p?.id) productIds[name] = p.id;
    }
  });

  const whIds: Record<string, number> = {};
  await t('仓库', async () => {
    for (const [i, name] of ['华东一号仓', '华南中心仓'].entries()) {
      const w = await post('/api/erp/warehouses', {
        name, address: `上海市嘉定区${name}路 88 号`, principal: name === '华东一号仓' ? '王建国' : '李国华',
        sort: i + 1, status: 'ENABLE', defaultStatus: i === 0 ? 1 : 0,
      });
      if (w?.id) whIds[name] = w.id;
    }
  });

  const supplierIds: Record<string, number> = {};
  await t('供应商', async () => {
    const rows = [
      '华科数码', '联创贸易', '未来办公', '精工电子',
    ];
    for (const [i, name] of rows.entries()) {
      const s = await post('/api/erp/suppliers', {
        name, mobile: '139' + String(10000000 + i * 11), detailAddress: `${['杭州', '深圳', '上海', '苏州'][i]}市高新区科技园 ${i + 1} 号楼`,
        status: 'ENABLE', remark: '资源方-演示',
      });
      if (s?.id) supplierIds[name] = s.id;
    }
  });

  await t('数据字典（来源/行业/地区）', async () => {
    const dicts: Array<[string, string[], string]> = [
      ['/api/crm/source-dicts', ['官网注册', '陌拜拜访', '展会获客', '客户转介'], 'SOURCE'],
      ['/api/crm/industry-dicts', ['信息技术', '制造业', '零售与电商'], 'INDUSTRY'],
      ['/api/crm/area-dicts', ['上海', '深圳', '杭州', '苏州', '北京', '广州'], 'AREA'],
    ];
    for (const [path, names, _k] of dicts) {
      for (const name of names) await post(path, { name, status: 'ENABLE' });
    }
  });

  // 供应商 FK 列表项取自上面灌入的供应商；客户沿用 CRM 客户 id
  const supplierId = supplierIds;
  const custId = { '明光科技': 1, '蓝海商贸': 2, '云启信息': 3, '锦程实业': 4 };

  const finAccIds: Record<string, number> = {};
  await t('结算账户', async () => {
    for (const [i, name] of ['招商银行基本户', '工商银行一般户'].entries()) {
      const a = await post('/api/erp/finance-accounts', { name, no: '6225' + String(88001234 + i), sort: i + 1, defaultStatus: i === 0 ? 1 : 0, status: 'ENABLE' });
      if (a?.id) finAccIds[name] = a.id;
    }
  });

  // ================= 库存 =================
  await t('库存期初入库 + 出库（Stock + 变动明细）', async () => {
    const inits: Array<[string, string, number]> = [
      ['联想 拯救者 Y9000P 笔记本电脑', '华东一号仓', 120],
      ['联想 拯救者 Y9000P 笔记本电脑', '华南中心仓', 60],
      ['戴尔 U2723QE 4K 显示器', '华东一号仓', 80],
      ['罗技 MX Master 3S 无线鼠标', '华东一号仓', 500],
      ['罗技 MX Master 3S 无线鼠标', '华南中心仓', 300],
      ['绿联 氮化镓 65W 充电器', '华东一号仓', 400],
      ['金士顿 DDR5 32G 内存条', '华东一号仓', 200],
      ['得力 A4 复印纸 80g', '华东一号仓', 1000],
      ['晨光 中性笔 0.5mm(12支)', '华东一号仓', 2000],
    ];
    for (const [pn, wn, count] of inits) {
      await post('/api/erp/stock-records/in', { productId: productIds[pn], warehouseId: whIds[wn], count });
    }
    await post('/api/erp/stock-records/out', { productId: productIds['罗技 MX Master 3S 无线鼠标'], warehouseId: whIds['华东一号仓'], count: 20 });
    await post('/api/erp/stock-records/out', { productId: productIds['联想 拯救者 Y9000P 笔记本电脑'], warehouseId: whIds['华东一号仓'], count: 10 });
  });

  // ================= 采购 =================
  let po1Id: number | null = null;
  let po2Id: number | null = null;
  await t('采购订单', async () => {
    const po1 = await post('/api/erp/purchase-orders', {
      no: 'PO20260901001', orderTime: $('2026-09-01T09:30:00'), supplierId: supplierId['华科数码'],
      accountId: finAccIds['招商银行基本户'], discountPrice: 0, remark: '九月第一批采购，审核通过',
      items: [
        { productId: productIds['联想 拯救者 Y9000P 笔记本电脑'], productUnitId: unitIds['台'], productPrice: 6499, count: 30, taxPercent: 13 },
        { productId: productIds['戴尔 U2723QE 4K 显示器'], productUnitId: unitIds['台'], productPrice: 2899, count: 40, taxPercent: 13 },
      ],
    });
    const po2 = await post('/api/erp/purchase-orders', {
      no: 'PO20260915001', orderTime: $('2026-09-15T14:00:00'), supplierId: supplierId['未来办公'],
      accountId: finAccIds['工商银行一般户'], discountPrice: 0, remark: '办公耗材补货',
      items: [
        { productId: productIds['得力 A4 复印纸 80g'], productUnitId: unitIds['盒'], productPrice: 108, count: 300, taxPercent: 13 },
        { productId: productIds['晨光 中性笔 0.5mm(12支)'], productUnitId: unitIds['盒'], productPrice: 15, count: 500, taxPercent: 13 },
      ],
    });
    const po3 = await post('/api/erp/purchase-orders', {
      no: 'PO20260918001', orderTime: $('2026-09-18T10:00:00'), supplierId: supplierId['联创贸易'],
      accountId: finAccIds['招商银行基本户'], discountPrice: 0, remark: '数码配件采购',
      items: [
        { productId: productIds['罗技 MX Master 3S 无线鼠标'], productUnitId: unitIds['个'], productPrice: 449, count: 100, taxPercent: 13 },
      ],
    });
    // PO1 不显式审批：由「入库审批」按累计入库量推进（dev/45 F3 链路）
    if (po3?.id) await post(`/api/erp/purchase-orders/${po3.id}/audit`, {});
    po1Id = po1?.id ?? null;
    po2Id = po2?.id ?? null;
  });

  await t('采购入库', async () => {
    const pi1 = await post('/api/erp/purchase-ins', {
      no: 'PI20260905001', inTime: $('2026-09-05T16:00:00'), supplierId: supplierId['华科数码'], accountId: finAccIds['招商银行基本户'],
      orderId: po1Id, orderNo: 'PO20260901001',
      remark: 'PO20260901001 对应入库（审批后推进订单）', discountPrice: 0, otherPrice: 0,
      items: [
        { orderItemId: null, warehouseId: whIds['华东一号仓'], productId: productIds['联想 拯救者 Y9000P 笔记本电脑'], productUnitId: unitIds['台'], productPrice: 6499, count: 30, taxPercent: 13 },
        { orderItemId: null, warehouseId: whIds['华东一号仓'], productId: productIds['戴尔 U2723QE 4K 显示器'], productUnitId: unitIds['台'], productPrice: 2899, count: 40, taxPercent: 13 },
      ],
    });
    const pi2 = await post('/api/erp/purchase-ins', {
      no: 'PI20260916001', inTime: $('2026-09-16T09:00:00'), supplierId: supplierId['未来办公'], accountId: finAccIds['工商银行一般户'],
      orderId: po2Id, orderNo: 'PO20260915001',
      remark: 'PO20260915001 对应入库（未审批）', discountPrice: 0, otherPrice: 0,
      items: [
        { orderItemId: null, warehouseId: whIds['华东一号仓'], productId: productIds['得力 A4 复印纸 80g'], productUnitId: unitIds['盒'], productPrice: 108, count: 300, taxPercent: 13 },
        { orderItemId: null, warehouseId: whIds['华东一号仓'], productId: productIds['晨光 中性笔 0.5mm(12支)'], productUnitId: unitIds['盒'], productPrice: 15, count: 500, taxPercent: 13 },
      ],
    });
    if (pi1?.id) await post(`/api/erp/purchase-ins/${pi1.id}/audit`, {});
    void pi2;
  });

  await t('采购退货', async () => {
    await post('/api/erp/purchase-returns', {
      no: 'PR20260920001', returnTime: $('2026-09-20T11:00:00'), supplierId: supplierId['华科数码'], accountId: finAccIds['招商银行基本户'],
      remark: '部分货物返厂（未审批）', discountPrice: 0, otherPrice: 0,
      items: [
        { orderItemId: null, warehouseId: whIds['华东一号仓'], productId: productIds['戴尔 U2723QE 4K 显示器'], productUnitId: unitIds['台'], productPrice: 2899, count: 2, taxPercent: 13 },
      ],
    });
  });

  await t('采购付款单', async () => {
    const pp = await post('/api/erp/purchase-payments', {
      no: 'PPMT20260906001', paymentTime: $('2026-09-06T10:00:00'), supplierId: supplierId['华科数码'], accountId: finAccIds['招商银行基本户'],
      remark: '华科数码首笔付款 30%',
      items: [
        { bizType: 'PURCHASE_IN', bizId: 1, bizNo: 'PI20260905001', totalPrice: 310870, paidPrice: 310870, paymentPrice: 93261 },
      ],
    });
    if (pp?.id) await post(`/api/erp/purchase-payments/${pp.id}/audit`, {});
  });

  // ================= 销售 =================
  await t('销售订单', async () => {
    const so1 = await post('/api/erp/sale-orders', {
      no: 'SO20260912001', orderTime: $('2026-09-12T15:00:00'), customerId: custId['明光科技'],
      accountId: finAccIds['招商银行基本户'], saleUserId: 1, discountPrice: 0, remark: '明光科技大客户采购（已审批）',
      items: [
        { productId: productIds['联想 拯救者 Y9000P 笔记本电脑'], productUnitId: unitIds['台'], productPrice: 7299, count: 10, taxPercent: 13 },
        { productId: productIds['罗技 MX Master 3S 无线鼠标'], productUnitId: unitIds['个'], productPrice: 499, count: 50, taxPercent: 13 },
      ],
    });
    const so2 = await post('/api/erp/sale-orders', {
      no: 'SO20260916001', orderTime: $('2026-09-16T09:20:00'), customerId: custId['蓝海商贸'],
      accountId: finAccIds['工商银行一般户'], saleUserId: 2, discountPrice: 0, remark: '蓝海商贸办公电脑整体更换',
      items: [
        { productId: productIds['戴尔 U2723QE 4K 显示器'], productUnitId: unitIds['台'], productPrice: 3299, count: 15, taxPercent: 13 },
      ],
    });
    if (so1?.id) await post(`/api/erp/sale-orders/${so1.id}/audit`, {});
    void so2;
  });

  await t('销售出库/退货/收款', async () => {
    await post('/api/erp/sale-outs', {
      no: 'SOUT20260913001', outTime: $('2026-09-13T14:30:00'), customerId: custId['明光科技'],
      accountId: finAccIds['招商银行基本户'], saleUserId: 1, orderId: 1, orderNo: 'SO20260912001', remark: '明光科技整单出库', discountPrice: 0, otherPrice: 0,
      items: [
        { warehouseId: whIds['华东一号仓'], productId: productIds['联想 拯救者 Y9000P 笔记本电脑'], productUnitId: unitIds['台'], productPrice: 7299, count: 10, taxPercent: 13 },
        { warehouseId: whIds['华东一号仓'], productId: productIds['罗技 MX Master 3S 无线鼠标'], productUnitId: unitIds['个'], productPrice: 499, count: 50, taxPercent: 13 },
      ],
    });

    await post('/api/erp/sale-returns', {
      no: 'SRET20260919001', returnTime: $('2026-09-19T09:10:00'), customerId: custId['明光科技'],
      accountId: finAccIds['招商银行基本户'], saleUserId: 1, orderId: 1, orderNo: 'SO20260912001', remark: '客户退 2 台适配问题机器', discountPrice: 0, otherPrice: 0,
      items: [
        { warehouseId: whIds['华东一号仓'], productId: productIds['联想 拯救者 Y9000P 笔记本电脑'], productUnitId: unitIds['台'], productPrice: 7299, count: 2, taxPercent: 13 },
      ],
    });

    const rc = await post('/api/erp/sale-receipts', {
      no: 'SRC20260920001', receiptTime: $('2026-09-20T15:00:00'), customerId: custId['明光科技'],
      accountId: finAccIds['招商银行基本户'], remark: '明光科技合同 50% 预收款',
      items: [
        { bizType: 'SALE_OUT', bizId: 1, bizNo: 'SOUT20260913001', totalPrice: 97840, receiptedPrice: 97840, receiptPrice: 48920 },
      ],
    });
    if (rc?.id) await post(`/api/erp/sale-receipts/${rc.id}/audit`, {});
  });

  // ================= CRM =================
  const crmCatIds: Record<string, number> = {};
  const crmProdIds: Record<string, number> = {};
  await t('CRM 产品分类/产品', async () => {
    for (const name of ['软件产品', '实施服务', '运维服务']) {
      const c = await post('/api/crm/product-categories', { name, status: 'ENABLE' });
      if (c?.id) crmCatIds[name] = c.id;
    }
    for (const [name, price] of [['ERP 标准版许可', 199900], ['定制化开发服务', 350000], ['年度运维服务', 88000]] as Array<[string, number]>) {
      const c = await post('/api/crm/products', { name, categoryId: crmCatIds['软件产品'], price, status: 'ENABLE', description: '芋道 ERP/CRM 一体化产品' });
      if (c?.id) crmProdIds[name] = c.id;
    }
  });

  const statusTypeId = (await post('/api/crm/business-status-types', { name: '标准销售漏斗' }))?.id;
  await t('商机状态组/状态', async () => {
    if (statusTypeId) {
      for (const [i, name] of ['初步接洽', '需求确认', '方案报价', '商务谈判', '赢单/输单'].entries()) {
        await post('/api/crm/business-statuses', { statusTypeId, name, percent: [10, 30, 50, 80, 100][i], sort: i + 1 });
      }
    }
  });

  const crmCustomerIds: Record<string, number> = {};
  await t('CRM 客户', async () => {
    // 覆盖三态：正常归属 / 公海（ownerUserId=0，可领取）/ 锁定（不可编辑与领取）
    const rows: Array<[string, string, number, string]> = [
      ['深圳市前海智联科技有限公司', '13700001111', 1, 'UNLOCKED'],
      ['南京星河网络科技', '13700002222', 1, 'LOCKED'],
      ['武汉东湖大数据有限公司', '13700003333', 0, 'UNLOCKED'],
      ['重庆山城智能制造', '13700004444', 0, 'UNLOCKED'],
    ];
    for (const [name, mobile, ownerUserId, lockStatus] of rows) {
      const c = await post('/api/crm/customers', {
        name, mobile, ownerUserId, dealStatus: 'UNDEALED', followUpStatus: 'FOLLOWED',
        source: 1, level: 2, areaId: 110000, detailAddress: '深圳市南山区科苑路 1 号',
      });
      if (c?.id) {
        crmCustomerIds[name] = c.id;
        // 锁定状态不在创建入参里 → 建完再锁（演示「锁定客户不可编辑/领取」）
        if (lockStatus === 'LOCKED') await post(`/api/crm/customers/${c.id}/lock`, {});
      }
    }
  });

  await t('CRM 联系人', async () => {
    const rows: Array<[string, string, string]> = [
      ['张伟', '13700001111', '深圳市前海智联科技有限公司'],
      ['李娜', '13700002222', '南京星河网络科技'],
      ['王强', '13700003333', '武汉东湖大数据有限公司'],
      ['陈静', '13700004444', '武汉东湖大数据有限公司'],
    ];
    for (const [name, mobile, cn] of rows) {
      await post('/api/crm/contacts', {
        name, mobile, customerId: crmCustomerIds[cn], ownerUserId: 1, sex: name === '陈静' ? 'FEMALE' : 'MALE',
        master: name === '张伟' ? 1 : 0, post: ['采购总监', '技术负责人', 'IT 经理', '财务负责人'][rows.indexOf([name, mobile, cn])],
      });
    }
  });

  await t('CRM 线索', async () => {
    for (const [name, mobile] of [['上海星海科技', '13600001111'], ['杭州云上网络', '13600002222']] as Array<[string, string]>) {
      await post('/api/crm/clues', { name, mobile, ownerUserId: 1, followUpStatus: 'UNFOLLOWED', transformStatus: 'UNTRANSFORMED', source: 2, detailAddress: '上海市浦东新区张江高科' });
    }
  });

  await t('CRM 商机', async () => {
    const biz1 = await post('/api/crm/businesses', {
      name: '前海智联 ERP 升级项目', customerId: crmCustomerIds['深圳市前海智联科技有限公司'], ownerUserId: 1,
      followUpStatus: 'FOLLOWED', statusTypeId, statusId: 4, discountPercent: 95, remark: '替换旧系统，预算 80 万',
      products: [
        { productId: crmProdIds['ERP 标准版许可'], productPrice: 199900, businessPrice: 299000, count: 1 },
        { productId: crmProdIds['定制化开发服务'], productPrice: 350000, businessPrice: 320000, count: 1 },
      ],
    });
    const biz2 = await post('/api/crm/businesses', {
      name: '武汉东湖大数据 CRM 采购', customerId: crmCustomerIds['武汉东湖大数据有限公司'], ownerUserId: 1,
      followUpStatus: 'FOLLOWED', statusTypeId, statusId: 2, discountPercent: 100, remark: '预算 30 万',
      products: [
        { productId: crmProdIds['年度运维服务'], productPrice: 88000, businessPrice: 88000, count: 1 },
      ],
    });
    if (biz1?.id) { await post(`/api/crm/businesses/${biz1.id}/win`, {}); await post(`/api/crm/businesses/${biz1.id}/win`, {}); }
void biz2;
  });

  await t('CRM 合同', async () => {
    const c = await post('/api/crm/contracts', {
      name: '前海智联 ERP 销售合同', no: 'HT20260901001', customerId: crmCustomerIds['深圳市前海智联科技有限公司'], businessId: 1,
      ownerUserId: 1, signContactId: 1, signUserId: 1, orderDate: $('2026-09-01T10:00:00'), startTime: $('2026-09-10T00:00:00'), endTime: $('2027-09-09T23:59:59'),
      discountPercent: 95, remark: '含 3 年运维服务',
      products: [
        { productId: crmProdIds['ERP 标准版许可'], productPrice: 199900, contractPrice: 189905, count: 1 },
        { productId: crmProdIds['定制化开发服务'], productPrice: 350000, contractPrice: 332500, count: 1 },
      ],
    });
    if (c?.id) { await post(`/api/crm/contracts/${c.id}/submit`, {}); await post(`/api/crm/contracts/${c.id}/approve`, {}); }
  });

  await t('CRM 回款计划/回款', async () => {
    await post('/api/crm/receivable-plans', { period: 1, customerId: crmCustomerIds['深圳市前海智联科技有限公司'], ownerUserId: 1, contractId: 1, returnTime: $('2026-09-30T00:00:00'), returnType: 'BANK', price: 261100, remindDays: 7, remark: '首期 50%' });
    await post('/api/crm/receivable-plans', { period: 2, customerId: crmCustomerIds['深圳市前海智联科技有限公司'], ownerUserId: 1, contractId: 1, returnTime: $('2026-12-31T00:00:00'), returnType: 'BANK', price: 261100, remindDays: 7, remark: '尾款 50%' });
    const r = await post('/api/crm/receivables', { no: 'RECV20260901001', planId: 1, customerId: crmCustomerIds['深圳市前海智联科技有限公司'], ownerUserId: 1, auditStatus: 'UNSUBMIT', price: 261100, returnTime: $('2026-09-30T10:00:00'), returnType: 'BANK', remark: '首期回款已到账' });
    if (r?.id) await post(`/api/crm/receivables/${r.id}/approve`, {});
  });

  await t('CRM 跟进记录 & 待办', async () => {
    await post('/api/crm/follow-up-records', { content: '现场演示 ERP 采购/库存模块，客户反馈良好，关注预算审批进度。', nextTime: $('2026-09-22T14:00:00'), nextFollowUpType: 1, bizType: 2, bizId: 1 });
    await post('/api/crm/follow-up-records', { content: '电话回访，初步报价已发客户邮箱。', nextTime: $('2026-09-18T10:00:00'), nextFollowUpType: 2, bizType: 2, bizId: 1 });
    await post('/api/crm/todos', { name: '给前海智联准备二期报价单', wakeUpTime: $('2026-09-25T09:00:00'), bizType: 2, bizId: 1, completed: 0 });
    await post('/api/crm/todos', { name: '跟进武汉东湖大数据合同盖章', wakeUpTime: $('2026-09-23T09:00:00'), bizType: 2, bizId: 2, completed: 0 });
  });

  console.log(`\n════════ 灌数完成：成功 ${pass}，失败 ${fail} ════════`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });