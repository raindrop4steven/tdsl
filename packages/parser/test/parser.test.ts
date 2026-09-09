import { describe, expect, it } from 'vitest';
import { parse, TdslSyntaxError, tokenize } from '../src/index';

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
