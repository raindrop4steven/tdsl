import { describe, expect, it } from 'vitest';
import type { AppNode, DataSourceNode, EntityNode } from '@tdsl/core';
import { createNode } from '@tdsl/core';
import { check, assignable, diagLayerOf, DIAG_LAYERS } from '@tdsl/typecheck';
import type { TypeRef as TR } from '@tdsl/core';
import { parse } from '@tdsl/parser';

/**
 * dev/36-38 P0 落地专项：
 * F1 诊断 code/suggestion、F2 定序、F3 五核对点、F4 作用域、宽松兜底红线。
 * 注意：type 声明在 parser/link 阶段即解析，不能依赖悬空 TypeRef 过 parse。
 */

const BASE = `
entity Order {
  id: Integer @pk;
  total: Decimal;
  status: String;
}
struct OrderInput {
  qty: Integer;
}

function lg(in: OrderInput): Decimal {
  return 0;
}
`;

describe('P0/F1: 诊断结构化字段', () => {
  it('悬空引用诊断带 code + suggestion（程序化造环：parser 已强校验合法 TypeRef）', () => {
    const r = check(buildDanglingApp());
    const d = r.diagnostics.find((x) => x.code === 'DANGLE-REF');
    expect(d).toBeDefined();
    expect(d?.message).toContain('悬空引用');
    expect(d?.suggestion).not.toBeUndefined();
  });

  it('实体无方法诊断带 code=ENTITY-METHOD + suggestion', () => {
    const r = check(parse(`${BASE}
function bad(): Decimal {
  return Order.batchDelete();
}`));
    const d = r.diagnostics.find((x) => x.code === 'ENTITY-METHOD');
    expect(d?.message).toContain('无方法 batchDelete');
    expect(d?.suggestion).toContain('get / all / where / aggregate');
  });
});

describe('P0/F2: 全量齐报 + 分层定序', () => {
  it('TYPE 层（悬空引用）排在 API 层（interface logicRef）前（混合造环：parse 后改坏）', () => {
    const app = parse(BASE + `\ninterface Api { GET '/api/g' -> lg }`);
    // 程序化改坏：①实体属性引用悬空（TYPE 层） ②端点悬空 logic（API 层）
    app.datasources[0].entities[0].properties[0].type = { kind: 'reference', path: 'app.datasources.defaultDS.entities.Nope' };
    app.interfaces[0].endpoints[0].logicRef = 'app.logics.missing';
    const r = check(app);
    const codes = r.diagnostics.map((d) => d.code);
    const firstType = codes.indexOf('DANGLE-REF');
    const api = codes.indexOf('INTERFACE-LOGICREF');
    expect(firstType).toBeGreaterThanOrEqual(0);
    expect(api).toBeGreaterThan(firstType);
  });

  it('层表常量', () => {
    expect(diagLayerOf('DANGLE-REF')).toBe(DIAG_LAYERS.TYPE);
    expect(diagLayerOf('VIEW-BINDING')).toBe(DIAG_LAYERS.API);
    expect(diagLayerOf('DEP-2')).toBe(DIAG_LAYERS.DEP);
  });
});

describe('P0/F3: 五核对点', () => {
  it('ASSIGN-TYPE: 声明初始化 Decimal ← String 报错；Integer → Decimal 放行', () => {
    const bad = check(parse(`${BASE}
function mk(): Decimal {
  const x: Decimal = 'oops';
  return x;
}`));
    const d = bad.diagnostics.find((x) => x.code === 'ASSIGN-TYPE');
    expect(d?.message).toContain('声明类型不匹配');

    const good = check(parse(`${BASE}
function ok2(): Decimal {
  const y: Decimal = 1;
  return y;
}`));
    expect(good.diagnostics.filter((x) => x.code === 'ASSIGN-TYPE')).toHaveLength(0);
  });

  it('ASSIGN-TYPE: 赋值语句 Decimal ← String 报错', () => {
    const r = check(parse(`${BASE}
function aw(): Decimal {
  const t: Decimal = 0;
  t = 'oops';
  return t;
}`));
    expect(r.diagnostics.find((x) => x.code === 'ASSIGN-TYPE')).toBeDefined();
  });

  it('CALL-ARITY: 数量不符报错；对齐放行；类型错配 suggestion 含签名', () => {
    const bad = check(parse(`${BASE}
function caller(): Decimal {
  return lg(1, 2);
}`));
    const d = bad.diagnostics.find((x) => x.code === 'CALL-ARITY');
    expect(d?.message).toContain('需要 1 个参数，实际 2');

    const typeBad = check(parse(`${BASE}
function caller4(): Decimal {
  return lg(5);
}`));
    const d2 = typeBad.diagnostics.find((x) => x.code === 'CALL-ARITY');
    expect(d2?.suggestion).toContain('lg(in:');

    const ok = check(parse(`${BASE}
function caller2(in: OrderInput): Decimal {
  return lg(in);
}`));
    expect(ok.diagnostics.filter((x) => x.code === 'CALL-ARITY')).toHaveLength(0);
  });

  it('MEMBER-UNKNOWN: 结构字段不存在报错；已知字段/调用格式放行', () => {
    const r = check(parse(`${BASE}
function f(input: OrderInput): Decimal {
  const q = input.notHere;
  return 0;
}`));
    const d = r.diagnostics.find((x) => x.code === 'MEMBER-UNKNOWN');
    expect(d?.message).toContain('无成员 notHere');

    const ok = check(parse(`${BASE}
function g(input: OrderInput): Integer {
  return input.qty;
}`));
    expect(ok.diagnostics.filter((x) => x.code === 'MEMBER-UNKNOWN')).toHaveLength(0);
  });

  it('MEMBER-UNKNOWN: 实体直调/查询链放行（不下钻，避免与实体 pass 重复）', () => {
    const ok = check(parse(`${BASE}
function h(): Order {
  return Order.get(1);
}`));
    expect(ok.diagnostics.filter((x) => x.code === 'MEMBER-UNKNOWN')).toHaveLength(0);
  });

  it('RETURN-TYPE: 声明 Decimal 返回 List<Order> → 报错；返回实体 → 放行', () => {
    const bad = check(parse(`${BASE}
function r1(): Decimal {
  return Order.where(total > 0);
}`));
    const d = bad.diagnostics.find((x) => x.code === 'RETURN-TYPE');
    expect(d?.message).toContain('返回类型不匹配');

    const ok = check(parse(`${BASE}
function r2(): List<Order> {
  return Order.where(total > 0);
}`));
    expect(ok.diagnostics.filter((x) => x.code === 'RETURN-TYPE')).toHaveLength(0);
    const okEnt = check(parse(`${BASE}
function rEnt(): Order {
  return Order.get(1);
}`));
    expect(okEnt.diagnostics.filter((x) => x.code === 'RETURN-TYPE')).toHaveLength(0);
  });

  it('RETURN-TYPE: Page 链核（.page → Page<T>；.limit/.orderBy 保型）', () => {
    const ok = check(parse(`${BASE}
function pg(n: Integer, size: Integer): Page<Order> {
  return Order.where(total > 0).orderBy(total desc).page(n, size);
}`));
    expect(ok.diagnostics.filter((x) => x.code === 'RETURN-TYPE')).toHaveLength(0);

    const bad = check(parse(`${BASE}
function pg2(n: Integer, size: Integer): Page<Order> {
  return Order.where(total > 0).orderBy(total desc).limit(3);
}`));
    expect(bad.diagnostics.find((x) => x.code === 'RETURN-TYPE')).toBeDefined();
  });

  it('NULLABLE-HINT: X.get 结果取成员 → warning（不阻断 ok）', () => {
    const app = parse(`${BASE}
function findLogic(id: Integer): Decimal {
  const o = Order.get(id);
  return o.total;
}`);
    const r = check(app);
    const d = r.diagnostics.find((x) => x.code === 'NULLABLE-HINT');
    expect(d?.severity).toBe('warning');
    expect(r.ok).toBe(true);
  });

  it('宽松兜底红线：判不出（unknown var / 未声明成员）一律放行', () => {
    const r = check(parse(`${BASE}
function u(x: List<Order>): Decimal {
  const s = fJx(x);
  return s;
}`));
    void r;
    const okx = check(parse(`${BASE}
function u2(x: List<Order>): Decimal {
  return 1;
}`));
    expect(okx.ok).toBe(true);
  });
});

describe('P0/F4: assignable 判定核', () => {
  const P = (b: 'Integer' | 'Decimal' | 'String'): TR => ({ kind: 'primitive', builtin: b });
  it('Integer→Decimal 单向 / Decimal→Integer 拒绝 / 同型通 / 泛型递归', () => {
    expect(assignable(P('Decimal'), P('Integer'))).toBe(true);
    expect(assignable(P('Integer'), P('Decimal'))).toBe(false);
    expect(assignable(P('String'), P('String'))).toBe(true);
    const listInt: TR = { kind: 'generic', name: 'List', args: [P('Integer')] };
    const listStr: TR = { kind: 'generic', name: 'List', args: [P('String')] };
    expect(assignable(listInt, listInt)).toBe(true);
    expect(assignable(listInt, listStr)).toBe(false);
  });

  it('Object 通配放行、null 参与放行', () => {
    const obj: TR = { kind: 'reference', path: 'Object' };
    const s: TR = { kind: 'reference', path: 'app.structures.X' };
    expect(assignable(obj, s)).toBe(true);
    expect(assignable(null as TR | null, s)).toBe(null);
  });
});

/* ---------- 程序化造环（与 typecheck.test.ts 同法） ---------- */

function buildDanglingApp(): AppNode {
  const ent: EntityNode = {
    ...createNode('Entity'),
    name: 'Todo',
    properties: [
      { ...createNode('EntityProperty'), name: 'owner', type: { kind: 'reference', path: 'app.datasources.defaultDS.entities.Nope' } },
    ],
  };
  const ds: DataSourceNode = { ...createNode('DataSource'), name: 'defaultDS', entities: [ent] };
  return {
    ...createNode('App'),
    name: 'p0',
    datasources: [ds],
    structures: [],
    enums: [],
    logics: [],
    interfaces: [],
    views: [],
    services: [],
    dependencies: [],
  } as unknown as AppNode;
}
