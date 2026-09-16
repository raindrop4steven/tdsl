import { describe, expect, it } from 'vitest';
import { parse } from '@tdsl/parser';
import { generateReact } from '../src';

/** dev/48：门户看板组件 + 聚合查询 + 角色视角 */
function filesOf(src: string): Map<string, string> {
  const files = generateReact(parse(src));
  return new Map(files.map((f) => [f.path, f.content]));
}

const SRC = `
@datasource('erp')
entity PurchaseIn { id: Integer @pk; no: String; status: String; totalPrice: Decimal; }
@export
function queryErpPurchaseIn(): List<PurchaseIn> { return PurchaseIn.all; }
@export
function countErpPurchaseIn(): Integer { return PurchaseIn.aggregate(count()); }
@export
function countErpPurchaseInPending(): Integer { return PurchaseIn.where(status = 'UNAUDIT').aggregate(count()); }

@role('老板') @title('经营总览') @menu('门户')
page bossDashboard {
  <row>
    <col span={6}><statistic title="采购单数" dataSource={useQuery('countErpPurchaseIn')} /></col>
    <col span={6}><statistic title="待审批" dataSource={useQuery('countErpPurchaseInPending')} /></col>
  </row>
  <carousel autoplay={true}>
    <item title="九月采购节" text="办公设备满额返点" />
    <item title="盘点通知" text="9/30 前完成盘点" />
  </carousel>
  <list dataSource={useQuery('queryErpPurchaseIn')} title="近期入库">
    <item field="no" title="单号" />
    <item field="totalPrice" title="金额" />
  </list>
}

@title('采购入库列表') @menu('采购管理')
page erpPurchaseInList {
  <table dataSource={useQuery('queryErpPurchaseIn')}>
    <column field="no" title="入库单号" />
  </table>
}
`;

describe('codegen-react dev/48 门户看板与角色视角', () => {
  const files = filesOf(SRC);

  it('statistic 支持 dataSource 绑聚合查询（Number(data ?? 0)）', () => {
    const d = files.get('src/pages/bossDashboard.tsx')!;
    expect(d).toContain('<Statistic title="采购单数" value={Number(qCountErpPurchaseIn.data ?? 0)} valueStyle=');
    expect(d).toContain('<Card size="small" bordered={false}');
    expect(d).toContain("valueStyle={{ fontSize: 26, fontWeight: 600, color: '#1677ff' }}");
    expect(d).toContain("background: 'linear-gradient(135deg, #1677ff14 0%, #ffffff 72%)'");
    expect(d).toContain('<Statistic title="待审批" value={Number(qCountErpPurchaseInPending.data ?? 0)} valueStyle=');
    expect(d).toMatch(/import \{[^}]*Statistic[^}]*\}/);
  });

  it('row/col 栅格与 carousel/item 轮播', () => {
    const d = files.get('src/pages/bossDashboard.tsx')!;
    expect(d).toContain('<Row gutter={[16, 16]} style={{ marginBottom: 16 }}>');
    expect(d).toContain("style={{ display: 'flex', flexDirection: 'column' }}");
    expect(d).toContain('<Col span={6} style={{ display:');
    expect(d).toContain('<Carousel autoplay');
    expect(d).toContain("background: 'linear-gradient(135deg, #1677ff 0%, #1677ffbb 100%)'");
    expect(d).toContain('height: 160');
    expect(d).toContain('>九月采购节</h3>');
    expect(d).toMatch(/import \{[^}]*Row[^}]*Col[^}]*\}/);
    expect(d).toMatch(/import \{[^}]*Carousel[^}]*\}/);
  });

  it('list/item 只读列表（含标题与字段渲染）', () => {
    const d = files.get('src/pages/bossDashboard.tsx')!;
    expect(d).toContain('近期入库');
    expect(d).toContain('dataSource={qQueryErpPurchaseIn.data ?? []}');
    expect(d).toContain('pagination={{ pageSize: 5, size:');
    expect(d).toContain('<List.Item.Meta title={<span style={{ fontWeight: 600 }}>');
    expect(d).toContain("String(it.no ?? '')");
    expect(d).toContain('金额：');
    expect(d).toContain('<Card size="small" title="近期入库"');
    expect(d).toMatch(/import \{[^}]*List[^}]*\}/);
  });

  it('外壳不生成角色切换/过滤（@role 语法保留但不驱动外壳）', () => {
    const app = files.get('src/App.tsx')!;
    expect(app).not.toContain('PAGE_ROLES');
    expect(app).not.toContain('ROLES');
    expect(app).not.toContain('演示级');
    expect(app).toContain('const MODULES:');
    expect(app).toContain('items={pages}');
    expect(app).toContain('const HOME_ROUTE = FIRST_ROUTES[0]');
  });
});
