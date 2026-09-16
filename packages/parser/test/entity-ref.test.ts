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

  it('dev/48：@role 注解进 view.annotations；无 @role 不产该注解', () => {
    const app = parse(`
@role('老板,采购员') @title('经营总览') page bossDashboard { <row /> }
@title('普通页') page plainPage { <row /> }
`);
    const boss = app.views.find((v) => v.name === 'bossDashboard')!;
    expect(boss.annotations?.find((a) => a.name === 'role')?.args?.['value']).toBe('老板,采购员');
    const plain = app.views.find((v) => v.name === 'plainPage')!;
    expect(plain.annotations?.some((a) => a.name === 'role')).toBe(false);
  });

  it('dev/48：@ok 文案进 logic.annotations（生成器只搬运，不含业务知识）', () => {
    const app = parse(`
@export
@ok('已领取')
function takeCustomer(id: Integer): Boolean { return true; }

@export
function plain(id: Integer): Boolean { return true; }
`);
    const take = app.logics.find((l) => l.name === 'takeCustomer')!;
    expect(take.annotations?.find((a) => a.name === 'ok')?.args?.['value']).toBe('已领取');
    const plain = app.logics.find((l) => l.name === 'plain')!;
    expect(plain.annotations?.some((a) => a.name === 'ok') ?? false).toBe(false);
  });
});
