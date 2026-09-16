import { describe, expect, it } from 'vitest';
import { parseProject } from '@tdsl/parser';
import { generateReact } from '../src';

/** dev/45：动作状态化（visible/disabled/枚举字面量）+ 明细合计 + 详情只读子表 */
function gen(src: string): Map<string, string> {
  const files = generateReact(parseProject([{ path: '<t>', content: src }], 'demo'));
  return new Map(files.map((f) => [f.path, f.content]));
}

const SRC = `
@datasource('erp')
enum DocStatus { UNAUDIT('未审批'), AUDITED('已审批') }

entity PurchaseIn {
  id: Integer @pk;
  no: String;
  status: DocStatus;
}
entity PurchaseInItem {
  id: Integer @pk;
  inId: Integer;
  productId: Integer;
  count: Decimal;
  productPrice: Decimal;
}

@export
function queryErpPurchaseIn(no: String): List<PurchaseIn> { return PurchaseIn.all; }
@export
function auditErpPurchaseIn(id: Integer): Boolean { return true; }

struct PurchaseInInput {
  id: Integer;
  no: String;
  items: List<PurchaseInItemInput>;
}
struct PurchaseInItemInput { productId: Integer; count: Decimal; productPrice: Decimal; }

@export
function saveErpPurchaseIn(input: PurchaseInInput): PurchaseIn {
  const b = new PurchaseIn();
  b.no = input.no;
  b.save();
  return b;
}

struct PurchaseInDetail { in: PurchaseIn; items: List<PurchaseInItem>; }
@export
function getErpPurchaseInDetail(id: Integer): PurchaseInDetail {
  const d = new PurchaseInDetail();
  d.in = PurchaseIn.get(id);
  d.items = PurchaseInItem.where(inId = id);
  return d;
}

interface ErpApi {
  GET  '/api/erp/purchase-ins'       -> queryErpPurchaseIn
  GET  '/api/erp/purchase-ins/{id}/audit-log' -> getErpPurchaseInDetail
  POST '/api/erp/purchase-ins/{id}/audit' -> auditErpPurchaseIn
  POST '/api/erp/purchase-ins'       -> saveErpPurchaseIn
}

page erpPurchaseInList {
  <input field="no" label="入库单号" />
  <table dataSource={useQuery('queryErpPurchaseIn')}>
    <column field="no" title="入库单号" />
    <column field="status" title="单据状态" />
    <button text="审批" action={useMutation('auditErpPurchaseIn', row.id)}
            visible={row.status === DocStatus.UNAUDIT} />
    <button text="编辑" action={openDialog('erpPurchaseInForm', row)}
            disabled={row.status === DocStatus.AUDITED} />
  </table>
  <button text="新增入库单" action={openDialog('erpPurchaseInForm')} />
}

dialog erpPurchaseInForm {
  <form submit={useMutation('saveErpPurchaseIn')}>
    <input field="no" label="入库单号" />
    <repeat field="items">
      <input field="productId" label="产品" />
      <input field="count" label="数量" />
      <input field="productPrice" label="单价" />
    </repeat>
    <summary field="items" of="count" label="总数量" />
    <summary field="items" expr={count * productPrice} label="金额合计" />
    <button text="保存" />
  </form>
}

dialog erpPurchaseInDetail {
  <detail dataSource={useQuery('getErpPurchaseInDetail', initial.id)}>
    <text field="in.no" title="入库单号" />
    <repeat field="items" title="明细">
      <column field="productId" title="产品" />
      <column field="count" title="数量" />
    </repeat>
  </detail>
}
`;

describe('codegen-react dev/45 动作状态化 + 合计 + 详情子表', () => {
  const files = gen(SRC);

  it('visible → 条件渲染；枚举成员字面量化', () => {
    const list = files.get('src/pages/erpPurchaseInList.tsx')!;
    expect(list).toContain("{(row.status === 'UNAUDIT') && (<Button type=\"link\" size=\"small\"");
  });

  it('disabled → antd disabled 属性（枚举比较同样字面量化）', () => {
    const list = files.get('src/pages/erpPurchaseInList.tsx')!;
    expect(list).toContain("disabled={(row.status === 'AUDITED')}");
  });

  it('summary of → 单字段归约；expr → 明细行上下文表达式归约', () => {
    const form = files.get('src/pages/erpPurchaseInForm.tsx')!;
    expect(form).toContain('总数量：{(items.reduce((s, it) => s + Number(it.count), 0)).toFixed(2)}');
    expect(form).toContain('金额合计：{(items.reduce((s, it) => s + ((Number(it.count) * Number(it.productPrice))), 0)).toFixed(2)}');
  });

  it('详情子表 → 只读 Table，数据取结构体字段，列渲染枚举/外键/原值', () => {
    const detail = files.get('src/pages/erpPurchaseInDetail.tsx')!;
    expect(detail).toContain('dataSource={qGetErpPurchaseInDetail.data?.items ?? []}');
    expect(detail).toContain("dataIndex: 'productId'");
    expect(detail).toContain("dataIndex: 'count'");
    expect(detail).toMatch(/import \{[^}]*Descriptions[^}]*\}/);
    expect(detail).toMatch(/import \{[^}]*Table[^}]*\}/);
  });

  it('无 visible/disabled/summary 的页面生成结果不变（回归由既有用例覆盖）', () => {
    const simple = gen(`
@datasource('d')
entity E { id: Integer @pk; name: String; }
@export
function queryE(): List<E> { return E.all; }
interface A { GET '/api/e' -> queryE }
page eList {
  <table dataSource={useQuery('queryE')}>
    <column field="name" title="名称" />
    <button text="删除" action={useMutation('queryE', row.id)} />
  </table>
}
`).get('src/pages/eList.tsx')!;
    expect(simple).toContain('type="link" size="small"');
    expect(simple).not.toContain('disabled={');
    expect(simple).not.toContain('&& (');
  });
});
