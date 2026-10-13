# few-shot: enterprise patterns (excerpted from Yudao ERP/CRM)

> [中文](patterns-yudao.zh.md) · **English**

> Source: `examples/yudao/tdsl/*.tdsl` (8 shards compile, both targets build, check-spec 100%).
> These are the "how to write it right" patterns distilled from real yudao work — prefer these shapes when an LLM writes an enterprise app.
> Full context is in `../demo-yudao/`; `tdsl-skill/README.md` covers shard organization.

## 1. Enums with labels + label colors (00-model)

```ts
enum ProductStatus { ENABLE('Enabled', 'green'), DISABLE('Disabled', 'red') }
enum DocStatus { UNAUDIT('Unaudited', 'orange'), AUDITED('Audited', 'green') }
enum StockRecordBizType {
  PURCHASE_IN('Purchase in'), PURCHASE_IN_CANCEL('Purchase in (cancelled)'),
  SALE_OUT('Sale out'), ...
}
```

- Display label `KEY('label')`; color `KEY('label', 'color')` (declared by the business; the generator never guesses semantics).
- An entity field references an enum directly: `status: DocStatus;` → Java enum + frontend Select/Tag.

## 2. Explicit foreign key @ref + dropdown source (00-model / SystemUser usage)

```ts
categoryId: Integer @ref(ProductCategory);
unitId: Integer @ref(ProductUnit);
supplierId: Integer @ref(Supplier);
ownerUserId: Integer @ref(SystemUser, display: 'nickname');   // explicit display for a staff field
productId: Integer @ref(Product);
parentId: Integer @nullable @ref(ProductCategory);            // self-reference still needs explicit @ref
```

Companion: the target entity has a `query*` returning `List<that entity>` as the option source:

```ts
@export
function querySimpleProduct(...): List<Product> { return Product.where(status = ProductStatus.ENABLE); }
```

## 3. Shared business entry point (inventory-linkage helper, 20-stock)

Logic reused across multiple documents — such as status transitions and writing stock movements — is extracted into an **ordinary function without @export** (business-internal sharing), and document logic calls it:

```ts
function applyStock(productId: Integer, warehouseId: Integer, delta: Decimal,
                    bizType: StockRecordBizType, bizId: Integer, bizNo: String): Boolean {
  const rows = Stock.where(productId = productId, warehouseId = warehouseId);
  if (rows.count === 0) {
    if (delta < 0) { throw 'Insufficient stock'; }
    const init = new Stock();
    init.productId = productId; init.warehouseId = warehouseId; init.count = 0;
    init.save();
  }
  for (const s of Stock.where(productId = productId, warehouseId = warehouseId)) {
    const next = s.count + delta;
    if (next < 0) { throw 'Insufficient stock'; }
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

Business errors use `throw 'message'` (→ HTTP 400, the frontend auto-toasts the error); the approve/unapprove logic each call it once.

## 4. @ok operation feedback (10-product / 30-purchase)

Every write operation with UI declares its business feedback copy (**business copy lives in TDSL; the generator only transports it**):

```ts
@export @ok('Approved')
function auditErpPurchaseOrder(id: Integer): Boolean { ... }

@export @ok('Unapproved')
function deauditErpPurchaseOrder(id: Integer): Boolean { ... }
```

Failure paths are carried by `throw` and auto-toasted by the frontend; a button without `@ok` shows the default "Success" on success.

## 5. Stateful buttons: mutually exclusive visible / disabled actions (30-purchase)

```ts
page erpPurchaseOrderList {
  <table dataSource={useQuery('queryErpPurchaseOrder')}>
    <button text="Edit" action={openDialog('erpPurchaseOrderForm', row)}
            disabled={row.status === DocStatus.AUDITED} />          // disable editing once audited
    <button text="Delete" action={useMutation('deleteErpPurchaseOrder', row.id)} />  // auto confirm
    <button text="Approve" action={useMutation('auditErpPurchaseOrder', row.id)}
            visible={row.status === DocStatus.UNAUDIT} />           // mutually exclusive: only when unaudited
    <button text="Unapprove" action={useMutation('deauditErpPurchaseOrder', row.id)}
            visible={row.status === DocStatus.AUDITED} />
    <button text="Detail" action={openDialog('erpPurchaseOrderDetail', row)} />
  </table>
  <button text="New Purchase Order" action={openDialog('erpPurchaseOrderForm')} />   // page-level button → top right
}
```

The condition is a subset of row context: `row.<field>` comparisons + `DocStatus.MEMBER` + `&& / || / !`.

## 6. Line-item body with repeat dataSource (edit a list with line items directly, 30-purchase)

The repeat line-item rows of a master-detail form fetch independently (no request in create mode; falls back to initial.items initially):

```ts
dialog erpPurchaseOrderForm {
  <form submit={useMutation('saveErpPurchaseOrder')}>
    <input field="no" label="Purchase No" />
    <input field="supplierId" label="Supplier" />
    <repeat field="items" dataSource={useQuery('queryErpPurchaseOrderItems', initial.id)}>
      <input field="productId" label="Product" />
      <input field="productUnitId" label="Product Unit" />
      <input field="productPrice" label="Unit Price" />
      <input field="count" label="Qty" />
      <input field="taxPercent" label="Tax %" />
      <input field="remark" label="Remark" />
    </repeat>
    <button text="Save" />
  </form>
}
```

Companion line-item query logic + endpoint:

```ts
@export
function queryErpPurchaseOrderItems(orderId: Integer): List<PurchaseOrderItem> {
  return PurchaseOrderItem.where(orderId = orderId);
}
```

## 7. Detail drawer + embedded buttons (30-purchase)

Use a dialog + `<detail dataSource={useQuery('getXxx', initial.id)}>` for detail; keep edit/approve buttons inside the detail (using `row`):

```ts
@export
function getErpPurchaseOrder(id: Integer): PurchaseOrder {
  return PurchaseOrder.get(id);
}

@title('Purchase Order Detail') @menu('Purchasing')
dialog erpPurchaseOrderDetail {
  <detail dataSource={useQuery('getErpPurchaseOrder', initial.id)}>
    <text field="no" title="Purchase No" />
    <text field="orderTime" title="Order Time" />
    <text field="totalPrice" title="Amount After Discount" />
    <text field="totalCount" title="Total Qty" />
    <text field="remark" title="Remark" />
  </detail>
  <button text="Edit" action={openDialog('erpPurchaseOrderForm', row)}
          disabled={row.status === DocStatus.AUDITED} />
  <button text="Approve" action={useMutation('auditErpPurchaseOrder', row.id)}
          visible={row.status === DocStatus.UNAUDIT} />
}
```

**Flatten the detail DTO**: when aggregating line items for edit prefill, return `{ masterFields..., items }` (don't nest `{order, items}` two levels deep) so edit can pass `row` directly.

## 8. Two-level menu group @menu ('module/group')

```ts
@title('Customer Management') @menu('CRM/Customer Management')
page crmCustomerList { ... }
```

- One level = top-bar module; a two-level path with a slash → left-menu subgroup; no `@menu` falls under "Other".

## 9. Portal dashboard (05-portal)

Conditional aggregation + statistic / row+col / carousel / progress:

```ts
@export
function countErpPurchaseInPending(): Integer {
  return PurchaseIn.where(status = DocStatus.UNAUDIT).aggregate(count());
}

@title('Business Overview') @menu('Portal')
page bossDashboard {
  <carousel autoplay={true}>
    <item title="September Purchasing Festival" text="Office equipment: 5% back on orders over 100k, ends 9/30" />
  </carousel>
  <row>
    <col span={6}><statistic title="Sales Order Amount" suffix="USD" color="blue" dataSource={useQuery('sumErpSaleAmount')} /></col>
    <col span={8}><progress title="Annual Sales Target Completion" percent={72} color="blue" /></col>
  </row>
}
```

## 10. Common mistakes (compare before copying)

```ts
// ❌ FK field missing @ref: the list shows only a number and the form only an input — no reference name/dropdown
supplierId: Integer;                       // change to supplierId: Integer @ref(Supplier);
// ❌ Written like JS: ternary/==/arrow/template string/:=/for-in/logic — always use the lexical surface
// ❌ A page uses a function but forgets the interface endpoint → blank frontend (typecheck errors; add the endpoint first)
// ❌ Copying shared logic inline three times → extract a shared function without @export (see #3)
```
