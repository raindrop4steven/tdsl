# few-shot：企业实战范式（节选自芋道 ERP/CRM）

> [English](patterns-yudao.en.md) · **中文**

> 来源：`examples/yudao/tdsl/*.tdsl`（8 分片编译通过、双端 build 成功、check-spec 100%）。
> 这些是 yudao 实战沉淀的"怎么写才对"——LLM 写企业应用时优先照这些形态。
> 完整上下文在 `../demo-yudao/`；`tdsl-skill/README.md` 讲分片组织。

## 1. 枚举带中文标签 + 标签颜色（00-model）

```ts
enum ProductStatus { ENABLE('开启', 'green'), DISABLE('禁用', 'red') }
enum DocStatus { UNAUDIT('未审批', 'orange'), AUDITED('已审批', 'green') }
enum StockRecordBizType {
  PURCHASE_IN('采购入库'), PURCHASE_IN_CANCEL('采购入库取消'),
  SALE_OUT('销售出库'), ...
}
```

- 显示标签 `KEY('中文')`；颜色 `KEY('中文', 'color')`（业务声明，生成器不猜语义）。
- 实体字段直接引用枚举：`status: DocStatus;` → Java enum + 前端 Select/Tag。

## 2. 显式外键 @ref + 下拉数据源（00-model / SystemUser 用法）

```ts
categoryId: Integer @ref(ProductCategory);
unitId: Integer @ref(ProductUnit);
supplierId: Integer @ref(Supplier);
ownerUserId: Integer @ref(SystemUser, display: 'nickname');   // 人员字段显式 display
productId: Integer @ref(Product);
parentId: Integer @nullable @ref(ProductCategory);            // 自引用显式 @ref
```

配套：目标实体有 `query*` 返回 `List<该实体>` 当 option 源：

```ts
@export
function querySimpleProduct(...): List<Product> { return Product.where(status = ProductStatus.ENABLE); }
```

## 3. 共享业务入口（库存联动公共函数，20-stock）

状态推进/写流水这类被多单据复用的逻辑，抽成**不带 @export 的普通 function**（业务内部共享），单据 logic 调用它：

```ts
function applyStock(productId: Integer, warehouseId: Integer, delta: Decimal,
                    bizType: StockRecordBizType, bizId: Integer, bizNo: String): Boolean {
  const rows = Stock.where(productId = productId, warehouseId = warehouseId);
  if (rows.count === 0) {
    if (delta < 0) { throw '库存不足'; }
    const init = new Stock();
    init.productId = productId; init.warehouseId = warehouseId; init.count = 0;
    init.save();
  }
  for (const s of Stock.where(productId = productId, warehouseId = warehouseId)) {
    const next = s.count + delta;
    if (next < 0) { throw '库存不足'; }
    s.count = next;
    s.save();
    const rec = new StockRecord();
    rec.productId = productId; rec.warehouseId = warehouseId;
    rec.count = delta; rec.totalCount = next;
    rec.bizType = bizType; rec.bizId = bizId; rec.bizNo = bizNo;
    rec.save();
  }
  return true;
}
```

业务错误用 `throw '文案'`（→ HTTP 400，前端自动弹错误）；审批/反审批 logic 各调它一次。

## 4. @ok 操作反馈（10-product / 30-purchase）

每个有界面的写操作声明业务反馈文案（**业务文案写 TDSL，生成器只搬运**）：

```ts
@export @ok('审批完成')
function auditErpPurchaseOrder(id: Integer): Boolean { ... }

@export @ok('已反审批')
function deauditErpPurchaseOrder(id: Integer): Boolean { ... }
```

失败路径由 `throw` 承载，前端自动弹；未标 `@ok` 的按钮成功统一提示「操作成功」。

## 5. 状态化按钮：visible / disabled 互斥动作（30-purchase）

```ts
page erpPurchaseOrderList {
  <table dataSource={useQuery('queryErpPurchaseOrder')}>
    <button text="编辑" action={openDialog('erpPurchaseOrderForm', row)}
            disabled={row.status === DocStatus.AUDITED} />          // 已审批置灰编辑
    <button text="删除" action={useMutation('deleteErpPurchaseOrder', row.id)} />  // 自动二次确认
    <button text="审批" action={useMutation('auditErpPurchaseOrder', row.id)}
            visible={row.status === DocStatus.UNAUDIT} />           // 互斥：未审批才显示
    <button text="反审批" action={useMutation('deauditErpPurchaseOrder', row.id)}
            visible={row.status === DocStatus.AUDITED} />
    <button text="详情" action={openDialog('erpPurchaseOrderDetail', row)} />
  </table>
  <button text="新增采购订单" action={openDialog('erpPurchaseOrderForm')} />   // 页面级按钮 → 右上角
}
```

条件为行上下文子集：`row.<字段>` 比较 + `DocStatus.MEMBER` + `&& / || / !`。

## 6. 明细正文 repeat dataSource（列表直接编辑带明细，30-purchase）

主子表表单的 repeat 明细行独立取数（新增态不发请求、初始用 initial.items 兜底）：

```ts
dialog erpPurchaseOrderForm {
  <form submit={useMutation('saveErpPurchaseOrder')}>
    <input field="no" label="采购单号" />
    <input field="supplierId" label="供应商" />
    <repeat field="items" dataSource={useQuery('queryErpPurchaseOrderItems', initial.id)}>
      <input field="productId" label="产品" />
      <input field="productUnitId" label="产品单位" />
      <input field="productPrice" label="产品单价" />
      <input field="count" label="数量" />
      <input field="taxPercent" label="税率" />
      <input field="remark" label="备注" />
    </repeat>
    <button text="保存" />
  </form>
}
```

配套明细查询逻辑 + 端点：

```ts
@export
function queryErpPurchaseOrderItems(orderId: Integer): List<PurchaseOrderItem> {
  return PurchaseOrderItem.where(orderId = orderId);
}
```

## 7. 详情抽屉 + 内嵌按钮（30-purchase）

详情用 dialog + `<detail dataSource={useQuery('getXxx', initial.id)}>`；详情内保留编辑/审批按钮（用 row）：

```ts
@export
function getErpPurchaseOrder(id: Integer): PurchaseOrder {
  return PurchaseOrder.get(id);
}

@title('采购订单详情') @menu('采购管理')
dialog erpPurchaseOrderDetail {
  <detail dataSource={useQuery('getErpPurchaseOrder', initial.id)}>
    <text field="no" title="采购单号" />
    <text field="orderTime" title="下单时间" />
    <text field="totalPrice" title="优惠后金额" />
    <text field="totalCount" title="总数量" />
    <text field="remark" title="备注" />
  </detail>
  <button text="编辑" action={openDialog('erpPurchaseOrderForm', row)}
          disabled={row.status === DocStatus.AUDITED} />
  <button text="审批" action={useMutation('auditErpPurchaseOrder', row.id)}
          visible={row.status === DocStatus.UNAUDIT} />
}
```

**详情 DTO 扁平化**：聚合明细给编辑预填时，返回 `{ 主表字段..., items }`（别套 `{order, items}` 两层），编辑直接传 row。

## 8. 菜单分组 @menu 两级（'模块/分组'）

```ts
@title('客户管理') @menu('客户关系管理/客户管理')
page crmCustomerList { ... }
```

- 一级 = 顶栏模块；带斜杠的两级 → 左侧菜单子组；无 `@menu` 归入「其他」。

## 9. 门户看板（05-portal）

条件聚合 + statistic / row+col / carousel / progress：

```ts
@export
function countErpPurchaseInPending(): Integer {
  return PurchaseIn.where(status = DocStatus.UNAUDIT).aggregate(count());
}

@title('经营总览') @menu('门户')
page bossDashboard {
  <carousel autoplay={true}>
    <item title="九月采购节" text="办公设备采购满 10 万返 5%，截止 9/30" />
  </carousel>
  <row>
    <col span={6}><statistic title="销售订单金额" suffix="元" color="blue" dataSource={useQuery('sumErpSaleAmount')} /></col>
    <col span={8}><progress title="年度销售目标完成率" percent={72} color="blue" /></col>
  </row>
}
```

## 10. 常见错误形态（照抄前先对比）

```ts
// ❌ 缺 @ref 的外键字段：列表只显示数字、表单只给输入框——不渲染引用名/下拉
supplierId: Integer;                       // 改成 supplierId: Integer @ref(Supplier);
// ❌ 写法像 JS：三元/==/箭头/模板串/:=/for-in/logic —— 一律按词法面写
// ❌ 页面用了函数却忘了 interface 端点暴露 → 前端白屏（typecheck 报错，先补 endpoint）
// ❌ 共用逻辑内联复制三份 → 抽无 @export 的共享 function（见 #3）
```