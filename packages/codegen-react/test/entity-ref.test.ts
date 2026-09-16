import { describe, expect, it } from 'vitest';
import { parseProject } from '@tdsl/parser';
import type { AppNode } from '@tdsl/core';
import { generateReact } from '../src';

/** M10/M11 外键：**零推断**——只有 @ref 声明才渲染引用下拉/引用名；命名（xxxId）不构成语义 */
describe('codegen-react M10 显式 @ref', () => {
  it('表单字段 @ref → options 引用 ref 实体 display', () => {
    const src = `
@datasource('erp')
entity Supplier {
  id: Integer @pk;
  name: String;
}
entity SupplierDictention { id: Integer @pk; name: String; }
entity PurchaseOrder {
  id: Integer @pk;
  supplierId: Integer @ref(Supplier);
}

@export
function queryErpSupplier(): List<Supplier> { return Supplier.all; }

struct PurchaseOrderInput {
  id: Integer;
  supplierId: Integer;
}

@export
function savePurchaseOrder(input: PurchaseOrderInput): PurchaseOrder {
  const b = new PurchaseOrder();
  b.supplierId = input.supplierId;
  b.save();
  return b;
}

@title('采购订单新增')
dialog purchaseOrderForm {
  <form action={useMutation('savePurchaseOrder')}>
    <input field="supplierId" label="供应商" />
    <button text="保存" />
  </form>
}
`;
    const files = generateReact(parseProject([{ path: 'a.tdsl', content: src }], 'erp-order') as unknown as AppNode);
    const page = files.find((f) => f.path === 'src/pages/purchaseOrderForm.tsx')!.content;
    expect(page).toContain('qFkSupplierId = useQuery(() => api.queryErpSupplier())');
    expect(page).toContain("label: String(o.name)");
  });

  it('零推断：实体字段无 @ref（即使命名 xxxId、存在目标实体与查询）→ 原样数字，无 qFk/Select', () => {
    const src = `
@datasource('erp')
entity Supplier { id: Integer @pk; name: String; }
entity PurchaseOrder { id: Integer @pk; supplierId: Integer; }

@export
function queryErpSupplier(): List<Supplier> { return Supplier.all; }
@export
function queryErpPurchaseOrder(): List<PurchaseOrder> { return PurchaseOrder.all; }

interface Api {
  GET '/api/suppliers' -> queryErpSupplier
  GET '/api/orders' -> queryErpPurchaseOrder
}
page orderList {
  <table dataSource={useQuery('queryErpPurchaseOrder')}>
    <column field="supplierId" title="供应商" />
  </table>
}
`;
    const files = generateReact(parseProject([{ path: 'a.tdsl', content: src }], 'erp-order'));
    const page = files.find((f) => f.path === 'src/pages/orderList.tsx')!.content;
    expect(page).not.toContain('qFkSupplierId');
    expect(page).toContain("{ title: '供应商', dataIndex: 'supplierId' }");
  });

  it('表单/明细字段 @ref（结构体上声明）→ 渲染 Select 下拉', () => {
    const src = `
@datasource('erp')
entity Product { id: Integer @pk; name: String; }
entity OrderItem { id: Integer @pk; orderId: Integer; productId: Integer; count: Decimal; }
struct OrderItemInput { productId: Integer @ref(Product); count: Decimal; }
struct OrderInput { id: Integer; items: List<OrderItemInput>; }
entity Order { id: Integer @pk; }

@export
function queryErpProduct(): List<Product> { return Product.all; }

@export
function saveOrder(input: OrderInput): Order {
  const b = new Order();
  b.save();
  return b;
}

@title('订单编辑')
dialog orderForm {
  <form submit={useMutation('saveOrder')}>
    <repeat field="items">
      <input field="productId" label="产品" />
      <input field="count" label="数量" />
    </repeat>
    <button text="保存" />
  </form>
}
`;
    const files = generateReact(parseProject([{ path: 'a.tdsl', content: src }], 'erp-order'));
    const page = files.find((f) => f.path === 'src/pages/orderForm.tsx')!.content;
    expect(page).toContain('qFkProductId = useQuery(() => api.queryErpProduct())');
    expect(page).toContain("label: String(o.name)");
  });
});
