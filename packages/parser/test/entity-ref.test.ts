import { describe, expect, it } from 'vitest';
import { parse } from '../src/index';

/** M10 @ref 注解：短名/限定名 + display KV → link 绑定 nodePath */
describe('M10 @ref 注解', () => {
  const BASE = `
@datasource('erp')
entity Supplier {
  id: Integer @pk;
  name: String;
}
`;

  it('解析并绑定 nodePath，缺省 display=name', () => {
    const src = `${BASE}
entity PurchaseOrder {
  id: Integer @pk;
  supplierId: Integer @ref(Supplier);
}
`;
    const app = parse(src);
    const prop = app.datasources[0].entities[1].properties.find((p) => p.name === 'supplierId')!;
    expect(prop.ref).toBeDefined();
    expect(prop.ref!.entityPath).toBe('app.datasources.erp.entities.Supplier');
    expect(prop.ref!.display).toBe('name');
  });

  it('限定名 + display 参数一并解析', () => {
    const src = `${BASE}
entity Other {
  supplierId: Integer @ref(erp.Supplier, display: 'name');
}
`;
    const app = parse(src);
    const prop = app.datasources[0].entities[1].properties.find((p) => p.name === 'supplierId')!;
    expect(prop.ref!.entityPath).toBe('app.datasources.erp.entities.Supplier');
    expect(prop.ref!.display).toBe('name');
  });

  it('ref 目标无法解析 → 解析报错', () => {
    const src = `${BASE}
entity Other {
  supplierId: Integer @ref(NoSuchEnt);
}
`;
    expect(() => parse(src)).toThrow(/cannot resolve/);
  });
});
