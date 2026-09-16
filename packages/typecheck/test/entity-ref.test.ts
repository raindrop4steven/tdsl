import { describe, expect, it } from 'vitest';
import { parse } from '@tdsl/parser';
import { check } from '../src/index';

const BASE = `
@datasource('erp')
entity Supplier {
  id: Integer @pk;
  name: String;
  mobile: String;
}
function queryErpSupplier(): List<Supplier> {
  return Supplier.all;
}
function doNothing(): Integer { return 0; }
`;

/** M10 @ref 外键显式声明：typecheck 三类诊断 */
describe('M10 FK-REF 诊断', () => {
  it('合法 ref：零诊断', () => {
    const app = parse(`${BASE}
entity PurchaseOrder {
  id: Integer @pk;
  supplierId: Integer @ref(Supplier);
}
`);
    const result = check(app);
    expect(result.diagnostics.filter((d) => d.code.startsWith('FK-REF'))).toEqual([]);
  });

  it('display 字段缺失/非 String → FK-REF-DISPLAY', () => {
    const app = parse(`${BASE}
entity PurchaseOrder {
  id: Integer @pk;
  supplierId: Integer @ref(Supplier, display: 'mobile');
  otherId: Integer @ref(Supplier, display: 'nope');
}
`);
    const result = check(app);
    const display = result.diagnostics.filter((d) => d.code === 'FK-REF-DISPLAY');
    expect(display).toHaveLength(1);
    expect(display[0].message).toContain('nope');
    expect(display[0].severity).toBe('error');
  });

  it('目标缺查询逻辑 → warning FK-REF-NO-QUERY', () => {
    const app = parse(`${BASE}
entity Unqueried { id: Integer @pk; name: String; }
entity PurchaseOrder {
  id: Integer @pk;
  supplierId: Integer @ref(Unqueried);
}
`);
    const result = check(app);
    const noQuery = result.diagnostics.filter((d) => d.code === 'FK-REF-NO-QUERY');
    expect(noQuery).toHaveLength(1);
    expect(noQuery[0].severity).toBe('warning');
    expect(noQuery[0].suggestion).toContain('queryUnqueried');
  });
});
