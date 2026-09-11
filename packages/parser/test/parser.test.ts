import { describe, expect, it } from 'vitest';
import { parse, parseProject, TdslSyntaxError, tokenize } from '../src/index';

const SAMPLE = `
@datasource('defaultDS')
entity Todo {
  id: Integer @pk;
  title: String;
  done: Boolean;
}

struct TodoInput {
  title: String;
  done: Boolean;
}

@export
logic findTodos(): List<Todo> {
  result := new List<Todo>();
  for (todo in Todo.all) {
    if (todo.done === false) {
      result.add(todo);
    }
  }
  return result;
}
`;

describe('parser/lexer', () => {
  it('tokenizes operators and identifiers', () => {
    const tokens = tokenize('a === b && c <= d := e');
    const values = tokens.map((t) => t.value);
    expect(values).toContain('===');
    expect(values).toContain('&&');
    expect(values).toContain('<=');
    expect(values).toContain(':=');
  });
});

describe('parser/parse', () => {
  it('parses datasource + entity with annotations', () => {
    const app = parse(SAMPLE);
    expect(app.datasources).toHaveLength(1);
    expect(app.datasources[0].name).toBe('defaultDS');
    const todo = app.datasources[0].entities[0];
    expect(todo.name).toBe('Todo');
    expect(todo.properties[0].name).toBe('id');
    expect(todo.properties[0].primary).toBe(true);
    expect(todo.properties[1].type).toEqual({ kind: 'primitive', builtin: 'String' });
  });

  it('parses struct and enum', () => {
    const app = parse(SAMPLE);
    expect(app.structures[0].name).toBe('TodoInput');
    expect(app.structures[0].properties).toHaveLength(2);
  });

  it('links reference types to nodePaths', () => {
    const app = parse(SAMPLE);
    const ret = app.logics[0].returns[0].type;
    expect(ret.kind).toBe('generic');
    if (ret.kind === 'generic') {
      expect(ret.name).toBe('List');
      expect(ret.args[0]).toEqual({
        kind: 'reference',
        path: 'app.datasources.defaultDS.entities.Todo',
      });
    }
  });

  it('parses logic body statements', () => {
    const app = parse(SAMPLE);
    const body = app.logics[0].body;
    expect(body[0]).toMatchObject({ kind: 'VarDecl', name: 'result' });
    expect(body[1]).toMatchObject({ kind: 'ForEach', item: 'todo' });
    expect(body[2]).toMatchObject({ kind: 'Return' });
    // ForEach 内 If
    const forEach = body[1];
    if (forEach.kind === 'ForEach') {
      const inner = forEach.body[0];
      if (inner.kind === 'If') {
        expect(inner.cond).toMatchObject({
          kind: 'Binary',
          operator: '===',
          left: { kind: 'Member', obj: { kind: 'Ident', name: 'todo' }, prop: 'done' },
          right: { kind: 'Bool', value: false },
        });
      }
    }
  });

  it('new List<T>() becomes NewList with linked elem', () => {
    const app = parse(SAMPLE);
    const body = app.logics[0].body;
    if (body[0].kind === 'VarDecl' && body[0].init) {
      expect(body[0].init).toMatchObject({ kind: 'NewList' });
    }
  });

  it('reports syntax errors with line/col', () => {
    try {
      parse('entity Todo { id: Integer }');
      expect.unreachable('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TdslSyntaxError);
      expect((e as TdslSyntaxError).line).toBe(1);
    }
  });

  it('reports unresolved type references', () => {
    expect(() => parse('entity Todo { a: Missing; }')).toThrow(/cannot resolve type 'Missing'/);
  });

  it('allows same-name entities across datasources (M1 scope)', () => {
    const src = `
@datasource('erp')
entity Order { id: Integer @pk; }
@datasource('crm')
entity Order { id: Integer @pk; }
`;
    const app = parse(src);
    expect(app.datasources).toHaveLength(2);
    // 跨源同名实体 → 各自 nodePath 不同
    const paths = app.datasources.flatMap((ds) => ds.entities.map((e) => e.name));
    expect(paths).toEqual(['Order', 'Order']);
  });

  it('rejects duplicate names within same datasource', () => {
    const src = `
@datasource('ds1')
entity Todo { id: Integer @pk; }
@datasource('ds1')
entity Todo { id: Integer @pk; }
`;
    expect(() => parse(src)).toThrow(/duplicate entity 'Todo' in datasource 'ds1'/);
  });

  it('rejects duplicate names across concepts (structure vs entity)', () => {
    const src = `
entity Todo { id: Integer @pk; }
struct Todo { id: Integer; }
`;
    expect(() => parse(src)).toThrow(/duplicate type name 'Todo'/);
  });

  it('links qualified reference ds.Entity to full nodePath', () => {
    const src = `
@datasource('erp')
entity Order { id: Integer @pk; }
@datasource('crm')
entity Order { id: Integer @pk; }
struct Shipment { erpOrder: erp.Order; crmOrder: crm.Order; }
`;
    const app = parse(src);
    const s = app.structures[0];
    const t0 = s.properties[0].type;
    const t1 = s.properties[1].type;
    expect(t0.kind).toBe('reference');
    if (t0.kind === 'reference') expect(t0.path).toBe('app.datasources.erp.entities.Order');
    if (t1.kind === 'reference') expect(t1.path).toBe('app.datasources.crm.entities.Order');
  });

  it('rejects ambiguous short name across datasources without qualification', () => {
    const src = `
@datasource('erp')
entity Order { id: Integer @pk; }
@datasource('crm')
entity Order { id: Integer @pk; }
struct Shipment { o: Order; }
`;
    expect(() => parse(src)).toThrow(/ambiguous type 'Order'/);
  });

  it('parses entity without datasource into defaultDS', () => {
    const app = parse('entity Foo { name: String; }');
    expect(app.datasources).toHaveLength(1);
    expect(app.datasources[0].name).toBe('defaultDS');
    expect(app.datasources[0].entities[0].name).toBe('Foo');
  });
});

describe('parser/interface', () => {
  const CRUD = `
entity Todo { id: Integer @pk; title: String; done: Boolean; }

struct TodoInput { title: String; done: Boolean; }

@export
logic findTodos(): List<Todo> { return Todo.all; }
@export
logic createTodo(input: TodoInput): Todo { return new Todo(); }
@export
logic updateTodo(id: Integer, input: TodoInput): Todo { return new Todo(); }
@export
logic deleteTodo(id: Integer): Boolean { return true; }

interface TodoApi {
  GET    '/api/todos'       -> findTodos
  POST   '/api/todos'       -> createTodo
  PUT    '/api/todos/{id}'  -> updateTodo
  DELETE '/api/todos/{id}'  -> deleteTodo
}
`;

  it('parses interface with endpoints and binds logicRef', () => {
    const app = parse(CRUD);
    expect(app.interfaces).toHaveLength(1);
    const itf = app.interfaces[0];
    expect(itf.name).toBe('TodoApi');
    expect(itf.endpoints).toHaveLength(4);

    const get = itf.endpoints[0];
    expect(get.method).toBe('GET');
    expect(get.path).toBe('/api/todos');
    // logicRef 短名被 link 绑定为 nodePath
    expect(get.logicRef).toBe('app.logics.findTodos');

    const put = itf.endpoints[2];
    expect(put.method).toBe('PUT');
    expect(put.path).toBe('/api/todos/{id}');
    expect(put.logicRef).toBe('app.logics.updateTodo');
  });

  it('rejects invalid HTTP method', () => {
    expect(() => parse('interface X { FETCH \'/api/x\' -> findTodos }')).toThrow(
      /invalid HTTP method/,
    );
  });

  it('rejects dangling logicRef', () => {
    expect(() => parse("interface X { GET '/api/x' -> nope }")).toThrow(
      /cannot resolve logic 'nope'/,
    );
  });
});
describe('parser/operators', () => {
  it('parses full arithmetic with precedence', () => {
    const app = parse(`
entity T { id: Integer @pk; }
@export
logic calc(a: Integer, b: Integer): Integer {
  x := a * b + 2;
  y := a / b - 1;
  if (a >= b && b > 0) { return x; }
  return y;
}
`);
    const body = app.logics[0].body;
    const varDecls = body.filter((s) => s.kind === 'VarDecl');
    // a * b + 2 → Binary(+, Binary(*, a, b), 2)：乘法优先于加法
    const mul = (varDecls[0] as { init: { kind: string; left: unknown; operator: string } }).init;
    expect(mul.kind).toBe('Binary');
    if (mul.kind === 'Binary') {
      expect(mul.operator).toBe('+');
      const left = mul.left as { kind: string; operator: string };
      expect(left.kind).toBe('Binary');
      expect(left.operator).toBe('*');
    }
    // 除法 + 减法
    const div = (varDecls[1] as { init: { kind: string; operator: string } }).init;
    expect(div.kind).toBe('Binary');
    if (div.kind === 'Binary') expect(div.operator).toBe('-');
  });

  it('parses where query arg as Binary(=)', () => {
    const app = parse(`
entity Order { id: Integer @pk; }
entity OrderItem { id: Integer @pk; orderId: Integer; }
@export
logic find(id: Integer): List<OrderItem> {
  return OrderItem.where(orderId = id);
}
`);
    const ret = app.logics[0].body.find((s) => s.kind === 'Return') as {
      value: { kind: string; args: unknown[] };
    };
    expect(ret.value.kind).toBe('Call');
    const call = ret.value as unknown as { callee: { prop: string }; args: { kind: string; operator: string }[] };
    expect(call.callee.prop).toBe('where');
    expect(call.args[0].kind).toBe('Binary');
    expect(call.args[0].operator).toBe('=');
  });
});

describe('parser/page (M4 View)', () => {
  const PAGE_DSL = `
entity Order { id: Integer @pk; customer: String; total: Decimal; }
@export
logic listOrders(): List<Order> { return Order.all; }
@export
logic deleteOrder(id: Integer): Boolean { return true; }
interface OrderApi {
  GET    '/api/orders'      -> listOrders
  DELETE '/api/orders/{id}' -> deleteOrder
}
page OrderList {
  <table dataSource={useQuery('listOrders')}>
    <column field="id" />
    <column field="customer" />
    <button text="删除" action={useMutation('deleteOrder', row.id)} />
  </table>
  <button text="新增" action={navigate('OrderCreate')} />
}
page OrderCreate { }
`;

  it('parses page with JSX-subset elements and bindings', () => {
    const app = parse(PAGE_DSL);
    expect(app.views).toHaveLength(2);
    const list = app.views[0];
    expect(list.name).toBe('OrderList');
    expect(list.viewKind).toBe('page');
    // table > column
    const table = list.elements[0];
    expect(table.type).toBe('table');
    expect(table.children.filter((c) => c.type === 'column')).toHaveLength(2);
    // 行内按钮绑定 useMutation
    const delBtn = table.children.find((c) => c.type === 'button');
    expect(delBtn?.bindings[0].name).toBe('useMutation');
    expect(delBtn?.bindings[0].target).toBe('app.logics.deleteOrder');
    // 页级按钮 navigate
    const navBtn = list.elements[1];
    expect(navBtn.bindings[0].name).toBe('navigate');
    expect(navBtn.bindings[0].target).toBe('OrderCreate');
    // 顶层 button 的 text 属性
    expect(navBtn.props['text']).toBe('新增');
  });

  it('binds useQuery logicRef to nodePath', () => {
    const app = parse(PAGE_DSL);
    const table = app.views[0].elements[0];
    const q = table.bindings.find((b) => b.name === 'useQuery');
    expect(q?.target).toBe('app.logics.listOrders');
  });

  it('rejects dangling logic in page binding', () => {
    expect(() =>
      parse(`
entity Order { id: Integer @pk; }
@export
logic listOrders(): List<Order> { return Order.all; }
page X { <table dataSource={useQuery('nope')}><column field="id" /></table> }
`),
    ).toThrow(/cannot resolve logic 'nope'/);
  });

  it('rejects dangling page in navigate', () => {
    expect(() =>
      parse(`
entity Order { id: Integer @pk; }
@export
logic listOrders(): List<Order> { return Order.all; }
page X { <button action={navigate('Nope')} /> }
`),
    ).toThrow(/cannot resolve page 'Nope'/);
  });
});

describe('parser/M6 service + component', () => {
  const M6_DSL = `
entity Order { id: Integer @pk; customer: String; }
@export
logic listOrders(): List<Order> { return Order.all; }
@service(kind = 'dubbo', group = 'order-center', version = '1.0.0')
service UserService {
  getUser(id: Integer): Order;
}
@service(kind = 'bean', jar = 'com.example:order-sdk:1.0')
service OrderSdk {
  createOrder(input: Order): Order;
}
@service(kind = 'http', baseUrl = 'http://erp-center')
service ErpApi {
  GET '/api/orders/{id}' -> getOrder(id: Integer): Order;
}
interface OrderApi {
  GET '/api/orders' -> listOrders
}
component ECharts {
  pkg: 'echarts-for-react';
  defaultProps: { option: Json; style: Json };
  events: ['onClick'];
}
`;

  it('parses dubbo/bean/http services with operations', () => {
    const app = parse(M6_DSL);
    expect(app.services).toHaveLength(3);
    const dubbo = app.services[0];
    expect(dubbo.kind_).toBe('dubbo');
    expect(dubbo.config['group']).toBe('order-center');
    expect(dubbo.operations[0].name).toBe('getUser');
    expect(dubbo.operations[0].params[0].name).toBe('id');
    const http = app.services[2];
    expect(http.kind_).toBe('http');
    expect(http.operations[0].method).toBe('GET');
    expect(http.operations[0].path).toBe('/api/orders/{id}');
  });

  it('binds service operation type refs to nodePaths', () => {
    const app = parse(M6_DSL);
    const dubbo = app.services[0];
    expect(dubbo.operations[0].returns[0].type.kind === 'reference' ? dubbo.operations[0].returns[0].type.path : '').toContain('app.datasources');
  });

  it('parses component registration', () => {
    const app = parse(M6_DSL);
    expect(app.components).toHaveLength(1);
    const c = app.components[0];
    expect(c.name).toBe('ECharts');
    expect(c.pkg).toBe('echarts-for-react');
    expect(c.defaultProps).toContain('option');
    expect(c.events).toContain('onClick');
  });

  it('rejects service without kind in @service', () => {
    expect(() =>
      parse(`
service X { getUser(id: Integer): Order; }
entity Order { id: Integer @pk; }
`),
    ).toThrow(/@service\(kind/);
  });

  it('rejects service with unknown kind', () => {
    expect(() =>
      parse(`
@service(kind = 'grpc')
service X { getUser(id: Integer): Order; }
entity Order { id: Integer @pk; }
`),
    ).toThrow(/requires @service\(kind/);
  });

  it('rejects component without pkg', () => {
    expect(() =>
      parse(`
component X {
  events: ['onClick'];
}
`),
    ).toThrow(/requires pkg/);
  });
});

describe('parser/M2 查询语言', () => {
  const M2_DSL = `
@datasource('defaultDS')
entity Order {
  id: Integer @pk;
  customer: String;
  total: Decimal;
  status: String;
}

logic searchOrders(customer: String, minTotal: Decimal): List<Order> {
  return Order.where(customer like '%' + customer + '%', total >= minTotal);
}
logic topOrders(): List<Order> {
  return Order.where(total > 0).orderBy(total desc).limit(10);
}
logic pageOrders(n: Integer, size: Integer): Page<Order> {
  return Order.where(total > 0).orderBy(total desc).page(n, size);
}
logic orderStats(): Decimal {
  return Order.aggregate(sum(total));
}
logic sumByCustomer(): List<Map<Object>> {
  return Order.aggregate(sum(total)).groupBy(customer);
}
logic statusCount(): List<Order> {
  return Order.where(status in ['A', 'B']);
}
logic orQuery(): List<Order> {
  return Order.where(total > 100 || status = 'C');
}
`;

  it('parses where 多条件（逗号 = AND）+ like/>= 运算符', () => {
    const app = parse(M2_DSL);
    const body = app.logics[0].body;
    const ret = body.find((s) => s.kind === 'Return');
    if (!ret || ret.kind !== 'Return' || !ret.value) throw new Error('no return');
    const call = ret.value;
    expect(call.kind).toBe('Call');
    if (call.kind !== 'Call') return;
    expect(call.args).toHaveLength(2);
    const c0 = call.args[0];
    expect(c0).toMatchObject({ kind: 'Binary', operator: 'like' });
    const c1 = call.args[1];
    expect(c1).toMatchObject({ kind: 'Binary', operator: '>=', left: { kind: 'Ident', name: 'total' } });
  });

  it('parses 链式 .orderBy().limit() → 嵌套 Call(Member(...))', () => {
    const app = parse(M2_DSL);
    const ret = app.logics[1].body.find((s) => s.kind === 'Return');
    if (!ret || ret.kind !== 'Return' || !ret.value) throw new Error('no return');
    // 最外层是 limit 调用
    const outer = ret.value;
    expect(outer.kind).toBe('Call');
    if (outer.kind !== 'Call') return;
    expect(outer.callee).toMatchObject({ kind: 'Member', prop: 'limit' });
    expect(outer.args[0]).toMatchObject({ kind: 'Numeric', value: 10 });
    // 中层 orderBy：方向 desc → String 字面量
    if (outer.callee.kind !== 'Member') return;
    const mid = outer.callee.obj;
    expect(mid.kind).toBe('Call');
    if (mid.kind !== 'Call') return;
    expect(mid.callee).toMatchObject({ kind: 'Member', prop: 'orderBy' });
    expect(mid.args).toEqual([
      { kind: 'Ident', name: 'total' },
      { kind: 'String', value: 'desc' },
    ]);
  });

  it('parses .page(n, size) 链式', () => {
    const app = parse(M2_DSL);
    const ret = app.logics[2].body.find((s) => s.kind === 'Return');
    if (!ret || ret.kind !== 'Return' || !ret.value) throw new Error('no return');
    const outer = ret.value;
    expect(outer.kind).toBe('Call');
    if (outer.kind !== 'Call') return;
    expect(outer.callee).toMatchObject({ kind: 'Member', prop: 'page' });
    expect(outer.args).toHaveLength(2);
  });

  it('parses aggregate(sum(total)) 与 .groupBy()', () => {
    const app = parse(M2_DSL);
    // orderStats: Order.aggregate(sum(total))
    const ret3 = app.logics[3].body.find((s) => s.kind === 'Return');
    if (!ret3 || ret3.kind !== 'Return' || !ret3.value) throw new Error('no return');
    const agg = ret3.value;
    expect(agg.kind).toBe('Call');
    if (agg.kind !== 'Call') return;
    expect(agg.callee).toMatchObject({ kind: 'Member', prop: 'aggregate' });
    expect(agg.args[0]).toMatchObject({
      kind: 'Call',
      callee: { kind: 'Ident', name: 'sum' },
      args: [{ kind: 'Ident', name: 'total' }],
    });
    // sumByCustomer: aggregate(sum(total)).groupBy(customer)
    const ret4 = app.logics[4].body.find((s) => s.kind === 'Return');
    if (!ret4 || ret4.kind !== 'Return' || !ret4.value) throw new Error('no return');
    const g = ret4.value;
    expect(g.kind).toBe('Call');
    if (g.kind !== 'Call') return;
    expect(g.callee).toMatchObject({ kind: 'Member', prop: 'groupBy' });
    expect(g.args).toEqual([{ kind: 'Ident', name: 'customer' }]);
  });

  it('parses 数组字面量 [a, b] → NewList（in 条件右值）', () => {
    const app = parse(M2_DSL);
    const ret = app.logics[5].body.find((s) => s.kind === 'Return');
    if (!ret || ret.kind !== 'Return' || !ret.value) throw new Error('no return');
    const call = ret.value;
    expect(call.kind).toBe('Call');
    if (call.kind !== 'Call') return;
    const cond = call.args[0];
    expect(cond).toMatchObject({ kind: 'Binary', operator: 'in' });
    if (cond.kind !== 'Binary') return;
    expect(cond.right).toMatchObject({
      kind: 'NewList',
      items: [{ kind: 'String', value: 'A' }, { kind: 'String', value: 'B' }],
    });
  });

  it('parses && / || 顶层布尔组合', () => {
    const app = parse(M2_DSL);
    const ret = app.logics[6].body.find((s) => s.kind === 'Return');
    if (!ret || ret.kind !== 'Return' || !ret.value) throw new Error('no return');
    const call = ret.value;
    expect(call.kind).toBe('Call');
    if (call.kind !== 'Call') return;
    const cond = call.args[0];
    expect(cond).toMatchObject({ kind: 'Binary', operator: '||' });
  });

  it('rejects where 条件缺运算符', () => {
    expect(() =>
      parse(`
@datasource('d')
entity Order { id: Integer @pk; total: Decimal; }
logic bad(): List<Order> {
  return Order.where(total);
}
`),
    ).toThrow(/field op value/);
  });

  it('rejects orderBy 方向非法关键字', () => {
    expect(() =>
      parse(`
@datasource('d')
entity Order { id: Integer @pk; total: Decimal; }
logic bad(): List<Order> {
  return Order.where(total > 0).orderBy(total sideways);
}
`),
    ).toThrow(/sideways/);
  });
});

describe('parser/M7 多文件工程', () => {
  const A = `@datasource('defaultDS')
entity Order { id: Integer @pk; total: Decimal; }
`;
  const B = `@datasource('defaultDS')
entity OrderItem { id: Integer @pk; orderId: Integer; }
`;
  const B_REF = `struct OrderInput { total: Decimal; }

logic createOrder(input: OrderInput): Order {
  result := new Order();
  result.total = input.total;
  return result;
}
`;

  it('跨文件短名引用（logic 用别文件的 entity/struct）', () => {
    const app = parseProject([
      { path: 'a.tdsl', content: A },
      { path: 'b.tdsl', content: B_REF },
    ]);
    expect(app.logics).toHaveLength(1);
    expect(app.logics[0].returns[0].type).toMatchObject({
      kind: 'reference',
      path: 'app.datasources.defaultDS.entities.Order',
    });
    expect(app.structures[0].name).toBe('OrderInput');
  });

  it('文件顺序无关（倒序输入得到同构 AST）', () => {
    const files = [
      { path: 'b.tdsl', content: B },
      { path: 'a.tdsl', content: A },
      { path: 'c.tdsl', content: B_REF },
    ];
    const app = parseProject(files);
    const reversed = parseProject([...files].reverse());
    const shape = (x: typeof app) => ({
      entities: x.datasources.flatMap((d) => d.entities.map((e) => e.name)).sort(),
      structures: x.structures.map((s) => s.name),
      logics: x.logics.map((l) => l.name),
    });
    expect(shape(app)).toEqual(shape(reversed));
    // 引用绑定与文件顺序无关
    expect(app.logics[0].returns[0].type).toMatchObject({
      path: 'app.datasources.defaultDS.entities.Order',
    });
  });

  it('同名 datasource 跨文件合并（两文件实体归同一 ds）', () => {
    const app = parseProject([
      { path: 'a.tdsl', content: A },
      { path: 'b.tdsl', content: B },
    ]);
    expect(app.datasources).toHaveLength(1);
    expect(app.datasources[0].name).toBe('defaultDS');
    expect(app.datasources[0].entities.map((e) => e.name).sort()).toEqual(['Order', 'OrderItem']);
  });

  it('跨文件同数据源重名 entity 报错（消息含双文件）', () => {
    const B2 = `@datasource('defaultDS')
entity Order { id: Integer @pk; }
`;
    expect(() =>
      parseProject([
        { path: 'a.tdsl', content: A },
        { path: 'b.tdsl', content: B2 },
      ]),
    ).toThrow(/a\.tdsl.*b\.tdsl|b\.tdsl.*a\.tdsl/);
  });

  it('跨文件重名 logic 报错（消息含双文件）', () => {
    const B_LOGIC = `logic createOrder(): Integer {
  return 0;
}
`;
    const C_LOGIC = `logic createOrder(): Integer {
  return 1;
}
`;
    expect(() =>
      parseProject([
        { path: 'b.tdsl', content: B_LOGIC },
        { path: 'c.tdsl', content: C_LOGIC },
      ]),
    ).toThrow(/b\.tdsl.*c\.tdsl|c\.tdsl.*b\.tdsl/);
  });

  it('跨数据源同名实体合法（M1 语义不变，引用需限定名）', () => {
    const OTHER = `@datasource('erp')
entity Order { id: Integer @pk; }
`;
    const app = parseProject([
      { path: 'a.tdsl', content: A },
      { path: 'erp.tdsl', content: OTHER },
    ]);
    expect(app.datasources.map((d) => d.name).sort()).toEqual(['defaultDS', 'erp']);
    expect(app.datasources.every((d) => d.entities.length === 1)).toBe(true);
  });

  it('空文件合法（纯注释分片）', () => {
    const app = parseProject([
      { path: 'a.tdsl', content: A },
      { path: 'empty.tdsl', content: '// 空文件，只有注释' },
    ]);
    expect(app.datasources[0].entities).toHaveLength(1);
  });

  it('app 名参数化（codegen 包名跟随）', () => {
    const app = parseProject([{ path: 'a.tdsl', content: A }], 'erp-app');
    expect(app.name).toBe('erp-app');
  });

  it('按功能纵向切：同文件混排多段 + 跨文件引用共享模型', () => {
    const MODEL = `@datasource('defaultDS')
entity Order { id: Integer @pk; total: Decimal; }
struct OrderInput { total: Decimal; }
`;
    const FEATURE = `logic createOrder(input: OrderInput): Order {
  result := new Order();
  result.total = input.total;
  return result;
}

page OrderCreate {
  <form>
    <button onClick={useMutation('createOrder')} />
  </form>
}
`;
    const app = parseProject([
      { path: '01_order-model.tdsl', content: MODEL },
      { path: '02_order-create.tdsl', content: FEATURE },
    ]);
    expect(app.logics[0].returns[0].type).toMatchObject({
      path: 'app.datasources.defaultDS.entities.Order',
    });
    expect(app.views[0].name).toBe('OrderCreate');
  });

  it('parse 错误与顶层节点带来源文件标', () => {
    const app = parseProject([
      { path: 'a.tdsl', content: A },
      { path: 'b.tdsl', content: B_REF },
    ]);
    expect(app.logics[0].file).toBe('b.tdsl');
    expect(app.datasources[0].entities[0].file).toBe('a.tdsl');
    try {
      parseProject([{ path: 'bad.tdsl', content: 'entity {{{' }]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(TdslSyntaxError);
      if (e instanceof TdslSyntaxError) expect(e.file).toBe('bad.tdsl');
    }
  });

  it('parse() 单文件兼容入口：语义与 parseProject 单元素一致', () => {
    const app = parse(A + B_REF);
    expect(app.name).toBe('todo');
    expect(app.logics[0].returns[0].type).toMatchObject({
      path: 'app.datasources.defaultDS.entities.Order',
    });
    expect(app.logics[0].file).toBe('<stdin>');
  });
});

describe('parser/G1 中文化语法', () => {
  it('枚举项带显示标签 KEY(中文)；page 前置 @title 注解挂在 ViewNode.annotations', () => {
    const app = parse(`
@datasource('defaultDS')
enum SettleMode { CASH('现金'), ACCOUNT('对账') }
@title('商品列表')
page GoodsList { <text value="x" /> }
`);
    const en = app.enums.find((e) => e.name === 'SettleMode')!;
    expect(en.items.map((i) => i.label)).toEqual(["现金", "对账"]);
    const v = app.views.find((x) => x.name === 'GoodsList')!;
    expect(v.annotations?.find((a) => a.name === 'title')?.args?.['value']).toBe('商品列表');
  });
});

describe('parser/双语法（P11：TS 词法面兼容期）', () => {
  it('function/const(: T)/for-of 与 logic/:=/for-in 解析为同构 AST', () => {
    const legacy = parse(`
@datasource('defaultDS')
entity Order { id: Integer @pk; total: Decimal; }
struct OrderInput { total: Decimal; }
@export
logic createOrder(input: OrderInput): Order {
  order := new Order();
  order.total = input.total;
  for (it in input.items_list) {
    order.total = order.total + 1;
  }
  order.save();
  return order;
}
`);
    const modern = parse(`
@datasource('defaultDS')
entity Order { id: Integer @pk; total: Decimal; }
struct OrderInput { total: Decimal; }
@export
function createOrder(input: OrderInput): Order {
  const order = new Order();
  order.total = input.total;
  for (const it of input.items_list) {
    order.total = order.total + 1;
  }
  order.save();
  const zero: Decimal = 0;
  return zero;
}
`);
    expect(modern.logics.length).toBe(1);
    expect(modern.logics[0].body.map((s) => s.kind)).toEqual([
      'VarDecl', 'Assign', 'ForEach', 'CallStmt', 'VarDecl', 'Return',
    ]);
    // typed const → VarDecl.type（TS 词法面的类型标注进 AST）
    const decls = modern.logics[0].body.filter((s) => s.kind === 'VarDecl');
    expect((decls[1] as { type?: unknown }).type).toBeDefined();
    // legacy 与 modern 同构：顶层五段（VarDecl/Assign/ForEach/CallStmt/…）逐段对齐
    expect(legacy.logics[0].body.slice(0, 4).map((s) => s.kind)).toEqual(
      modern.logics[0].body.slice(0, 4).map((s) => s.kind),
    );
    const modernFor = modern.logics[0].body[2];
    expect(modernFor.kind).toBe('ForEach');
    expect((modernFor as { body: { kind: string }[] }).body.map((s) => s.kind)).toEqual(['Assign']);
  });
});

describe('parser/dev30 A1 throw 语句', () => {
  it('throw <expr>; → Throw 节点（message 表达式）', () => {
    const app = parse(`
@datasource('defaultDS')
@export
function f(x: Integer): Boolean {
  if (x === 0) { throw 'x 不可为 0'; }
  return true;
}
`);
    const fn = app.logics[0];
    const t = fn.body.find((s) => s.kind === 'Throw') ?? fn.body.flatMap((s) => s.kind === 'If' ? s.then : [])
      .find((s) => s.kind === 'Throw');
    expect(t).toBeDefined();
    expect((t as { kind: string; message: unknown }).kind).toBe('Throw');
  });
});
