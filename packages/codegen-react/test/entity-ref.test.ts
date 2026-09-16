import { describe, expect, it } from 'vitest';
import { parseProject } from '@tdsl/parser';
import type { AppNode } from '@tdsl/core';
import { generateReact } from '../src';

/** M10 显式 @ref：表单 FK 注解直出下拉；无注解走推断（兜底回归专用样例） */
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
});
