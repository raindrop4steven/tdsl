import { describe, expect, it } from 'vitest';
import { createNode, type AppNode, type DataSourceNode, type EntityNode } from '@tdsl/core';
import { parse, parseProject } from '@tdsl/parser';
import { check } from '../src/index';

const GOOD = `
@datasource('defaultDS')
entity Todo {
  id: Integer @pk;
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

describe('typecheck', () => {
  it('passes on valid app', () => {
    const app = parse(GOOD);
    const r = check(app);
    expect(r.ok).toBe(true);
    expect(r.diagnostics).toHaveLength(0);
  });

  it('reports dangling reference for programmatically-built AST', () => {
    const entity: EntityNode = {
      ...createNode('Entity'),
      name: 'Todo',
      properties: [
        {
          ...createNode('EntityProperty'),
          name: 'owner',
          type: { kind: 'reference', path: 'app.datasources.defaultDS.entities.Nope' },
        },
      ],
    };
    const ds: DataSourceNode = { ...createNode('DataSource'), name: 'defaultDS', entities: [entity] };
    const app: AppNode = {
      ...createNode('App'),
      name: 'todo',
      datasources: [ds],
      structures: [],
      enums: [],
      logics: [],
      interfaces: [],
      views: [],
      services: [],
      components: [],
    };
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].message).toContain('悬空引用');
    expect(r.diagnostics[0].severity).toBe('error');
  });

  it('reports invalid ForEach container', () => {
    const app = parse(`
entity Todo { id: Integer @pk; }
@export
logic bad(): List<Todo> {
  result := new List<Todo>();
  for (todo in something.else) { result.add(todo); }
  return result;
}
`);
    // 上面 something.else 引用不存在——parser link 不解析成员，typecheck 应报 ForEach 容器错
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('ForEach 容器'))).toBe(true);
  });

  it('reports dangling interface logicRef', () => {
    const app = parse(`
entity Todo { id: Integer @pk; }
@export
logic findTodos(): List<Todo> { return Todo.all; }
interface Api { GET '/api/todos' -> findTodos }
`);
    // 程序化改坏 logicRef，测 typecheck 兜底（parser 层已强校验合法路径）
    app.interfaces[0].endpoints[0].logicRef = 'app.logics.missing';
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('接口端点悬空引用 logic'))).toBe(true);
  });

  it('passes valid CRUD logic with entity methods', () => {
    const app = parse(`
entity Todo { id: Integer @pk; title: String; done: Boolean; }
struct TodoInput { title: String; done: Boolean; }
@export
logic findTodos(): List<Todo> { return Todo.all; }
@export
logic createTodo(input: TodoInput): Todo {
  todo := new Todo();
  todo.title = input.title;
  todo.done = input.done;
  todo.save();
  return todo;
}
`);
    const r = check(app);
    expect(r.ok).toBe(true);
  });

  it('reports unknown entity method', () => {
    const app = parse(`
entity Todo { id: Integer @pk; }
@export
logic bad(): List<Todo> { Todo.nope(); return Todo.all; }
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('实体 Todo 无方法'))).toBe(true);
  });

  it('reports entity get with wrong arity', () => {
    const app = parse(`
entity Todo { id: Integer @pk; }
@export
logic bad(): Todo { return Todo.get(); }
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('需要 1 个参数'))).toBe(true);
  });
});
describe('typecheck/order-scenario', () => {
  it('allows ForEach over struct List field (input.items)', () => {
    const app = parse(`
entity Order { id: Integer @pk; customer: String; total: Decimal; }
struct OrderInput { customer: String; items: List<OrderInputItem>; }
struct OrderInputItem { product: String; price: Decimal; qty: Integer; }
@export
logic create(input: OrderInput): Order {
  order := new Order();
  order.save();
  for (it in input.items) { order.total = order.total + it.price * it.qty; }
  order.save();
  return order;
}
`);
    const r = check(app);
    expect(r.ok).toBe(true);
  });

  it('allows ForEach over Entity.where(...)', () => {
    const app = parse(`
entity Order { id: Integer @pk; }
entity OrderItem { id: Integer @pk; orderId: Integer; }
@export
logic del(id: Integer): Boolean {
  for (it in OrderItem.where(orderId = id)) { it.delete(); }
  return true;
}
`);
    const r = check(app);
    expect(r.ok).toBe(true);
  });

  it('rejects where on unknown field', () => {
    const app = parse(`
entity Order { id: Integer @pk; }
@export
logic find(id: Integer): List<Order> {
  return Order.where(unknown = id);
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('无字段'))).toBe(true);
  });

  it('rejects ForEach over undefined variable member', () => {
    const app = parse(`
entity Todo { id: Integer @pk; }
@export
logic bad(): List<Todo> {
  result := new List<Todo>();
  for (todo in something.else) { result.add(todo); }
  return result;
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('ForEach 容器'))).toBe(true);
  });
});

describe('typecheck/M1 namespace', () => {
  it('resolves qualified entity in expression (erp.Order.all)', () => {
    const app = parse(`
@datasource('erp')
entity Order { id: Integer @pk; }
@datasource('crm')
entity Order { id: Integer @pk; }
@export
logic listErp(): List<erp.Order> {
  return erp.Order.all;
}
`);
    const r = check(app);
    expect(r.ok).toBe(true);
  });

  it('rejects unknown qualified entity method', () => {
    const app = parse(`
@datasource('erp')
entity Order { id: Integer @pk; }
@export
logic bad(): List<erp.Order> {
  return erp.Order.nope();
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('无方法'))).toBe(true);
  });

  it('ForEach over qualified where query', () => {
    const app = parse(`
@datasource('erp')
entity Order { id: Integer @pk; }
@datasource('erp')
entity OrderItem { id: Integer @pk; orderId: Integer; }
@export
logic del(id: Integer): Boolean {
  for (it in erp.OrderItem.where(orderId = id)) { it.delete(); }
  return true;
}
`);
    const r = check(app);
    expect(r.ok).toBe(true);
  });
});

describe('typecheck/M4 view', () => {
  it('passes valid page with bindings', () => {
    const app = parse(`
entity Order { id: Integer @pk; customer: String; }
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
    <button text="删" action={useMutation('deleteOrder', row.id)} />
  </table>
  <button text="新增" action={navigate('OrderCreate')} />
}
page OrderCreate { }
`);
    const r = check(app);
    expect(r.ok).toBe(true);
  });

  it('rejects unknown view element type', () => {
    const app = parse(`
entity Order { id: Integer @pk; }
@export
logic listOrders(): List<Order> { return Order.all; }
page X { <fancy dataSource={useQuery('listOrders')} /> }
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('未知页面组件类型'))).toBe(true);
  });

  it('rejects dangling binding logic', () => {
    const app = parse(`
entity Order { id: Integer @pk; }
@export
logic listOrders(): List<Order> { return Order.all; }
page X { <table dataSource={useQuery('listOrders')}><column field="id" /></table> }
`);
    // 程序化改坏 binding target 测 typecheck 兜底
    app.views[0].elements[0].bindings[0].target = 'app.logics.missing';
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('悬空逻辑引用'))).toBe(true);
  });

  it('rejects logic without interface endpoint（agent 忘写 interface → api.ts 缺函数 → 前端白屏，编译期拦截）', () => {
    const app = parse(`
entity Car { id: Integer @pk; plate: String; }
@export
logic listCars(): List<Car> { return Car.all; }
page CarList {
  <table dataSource={useQuery('listCars')}><column field="plate" /></table>
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('没有 interface 端点暴露该逻辑'))).toBe(true);
  });

  it('passes logic exposed via interface endpoint', () => {
    const app = parse(`
entity Car { id: Integer @pk; plate: String; }
@export
logic listCars(): List<Car> { return Car.all; }
interface CarApi { GET '/api/cars' -> listCars }
page CarList {
  <table dataSource={useQuery('listCars')}><column field="plate" /></table>
}
`);
    expect(check(app).ok).toBe(true);
  });

  it('管理端常用组件（tag/statistic/tabs/switch/badge/card）不再视为未知类型', () => {
    const app = parse(`
entity Car { id: Integer @pk; plate: String; }
@export
logic stats(): Decimal { return Car.aggregate(count(id)); }
@export
logic listCars(): List<Car> { return Car.all; }
interface CarApi { GET '/api/cars' -> listCars GET '/api/cars/stats' -> stats }
page Dashboard {
  <statistic title="总数" value={qStats.data} />
  <tabs>
    <pane title="车辆">
      <tag color="green" text="在租" />
      <avatar text="张" />
    </pane>
    <pane title="明细">
      <switch field="on" />
      <checkbox field="agree" />
      <radio field="type" options="A,B" />
      <badge count={qStats.data} text="告警" />
      <card title="卡" />
    </pane>
  </tabs>
}
`);
    const r = check(app);
    expect(r.diagnostics.filter((d) => d.message.includes('未知页面组件类型'))).toEqual([]);
  });

it('rejects dangling navigate page', () => {
    const app = parse(`
entity Order { id: Integer @pk; }
@export
logic listOrders(): List<Order> { return Order.all; }
page X { <button text="a" action={navigate('Y')} /> }
page Y { }
`);
    // navigate 绑定改坏（parser 已校验合法，测 typecheck 兜底）
    app.views[0].elements[0].bindings[0].target = 'Nope';
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('悬空页面'))).toBe(true);
  });
});

describe('typecheck/M6 service + component', () => {
  it('passes valid service plus logic calls', () => {
    const app = parse(`
entity Order { id: Integer @pk; customer: String; }
@export
logic createOrder(input: Order): Order {
  return userService.createOrder(input);
}
@service(kind = 'dubbo', group = 'order-center')
service UserService {
  createOrder(input: Order): Order;
}
`);
    const r = check(app);
    expect(r.ok).toBe(true);
  });

  it('rejects unknown service method', () => {
    const app = parse(`
entity Order { id: Integer @pk; customer: String; }
@export
logic createOrder(input: Order): Order {
  return userService.nope(input);
}
@service(kind = 'dubbo')
service UserService {
  createOrder(input: Order): Order;
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('无方法 nope'))).toBe(true);
  });

  it('rejects service call with wrong arg count', () => {
    const app = parse(`
entity Order { id: Integer @pk; customer: String; }
@export
logic createOrder(input: Order): Order {
  return userService.createOrder();
}
@service(kind = 'dubbo')
service UserService {
  createOrder(input: Order): Order;
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('需要 1 个参数'))).toBe(true);
  });

  it('rejects http service operation without method/path', () => {
    const app = parse(`
@service(kind = 'http')
service ErpApi {
  getOrder(id: Integer): Order;
}
entity Order { id: Integer @pk; }
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes("必须声明 METHOD 'path'"))).toBe(true);
  });

  it('passes component-referenced view element', () => {
    const app = parse(`
entity Order { id: Integer @pk; customer: String; }
@export
logic listOrders(): List<Order> { return Order.all; }
interface OrderApi { GET '/api/orders' -> listOrders }
component ECharts {
  pkg: 'echarts-for-react';
  defaultProps: { option: Json; style: Json };
}
page P {
  <ECharts option={null} dataSource={useQuery('listOrders')} />
}
`);
    const r = check(app);
    expect(r.ok).toBe(true);
  });

  it('rejects unregistered view element type', () => {
    const app = parse(`
entity Order { id: Integer @pk; customer: String; }
@export
logic listOrders(): List<Order> { return Order.all; }
page P {
  <Nope dataSource={useQuery('listOrders')} />
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('未知页面组件类型'))).toBe(true);
  });
});

describe('typecheck/M2 查询语言', () => {
  it('passes where 多条件 + 链式 + aggregate + groupBy', () => {
    const app = parse(`
@datasource('d')
entity Order {
  id: Integer @pk;
  customer: String;
  total: Decimal;
  status: String;
}
@export
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
`);
    const r = check(app);
    expect(r.ok).toBe(true);
  });

  it('rejects where 字段不存在', () => {
    const app = parse(`
@datasource('d')
entity Order { id: Integer @pk; total: Decimal; }
@export
logic bad(): List<Order> {
  return Order.where(totalX > 0);
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('无字段 totalX'))).toBe(true);
  });

  it('rejects where 非法运算符（parser 层）', () => {
    expect(() =>
      parse(`
@datasource('d')
entity Order { id: Integer @pk; total: Decimal; }
@export
logic bad(): List<Order> {
  return Order.where(total === 0);
}
`),
    ).toThrow(/field op value/);
  });

  it('rejects orderBy 字段不存在', () => {
    const app = parse(`
@datasource('d')
entity Order { id: Integer @pk; total: Decimal; }
@export
logic bad(): List<Order> {
  return Order.where(total > 0).orderBy(customerX asc);
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('不存在') && d.message.includes('customerX'))).toBe(true);
  });

  it('rejects page 参数个数错误', () => {
    const app = parse(`
@datasource('d')
entity Order { id: Integer @pk; total: Decimal; }
@export
logic bad(): Page<Order> {
  return Order.where(total > 0).page(1);
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('.page() 需要 2 个参数'))).toBe(true);
  });

  it('rejects aggregate 非法函数', () => {
    const app = parse(`
@datasource('d')
entity Order { id: Integer @pk; total: Decimal; }
@export
logic bad(): Decimal {
  return Order.aggregate(mean(total));
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes("不支持聚合函数 'mean'"))).toBe(true);
  });

  it('rejects groupBy 字段不存在', () => {
    const app = parse(`
@datasource('d')
entity Order { id: Integer @pk; total: Decimal; customer: String; }
@export
logic bad(): List<Map<Object>> {
  return Order.aggregate(sum(total)).groupBy(customerX);
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('不存在') && d.message.includes('customerX'))).toBe(true);
  });

  it('rejects 实体查询链上未知方法', () => {
    const app = parse(`
@datasource('d')
entity Order { id: Integer @pk; total: Decimal; }
@export
logic bad(): List<Order> {
  return Order.where(total > 0).frobnicate();
}
`);
    const r = check(app);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes('查询链无方法'))).toBe(true);
  });
});

describe('typecheck/M7 多文件工程', () => {
  it('诊断带 file：跨文件悬空类型引用定位到引用所在文件', () => {
    const app = parseProject([
      { path: 'a.tdsl', content: "@datasource('d')\nentity Order { id: Integer @pk; total: Decimal; }\n" },
      { path: 'b.tdsl', content: "logic bad(): List<Order> {\n  return Order.where(nofield > 0);\n}\n" },
    ]);
    const r = check(app);
    expect(r.ok).toBe(false);
    const d = r.diagnostics.find((x) => x.message.includes('nofield'));
    expect(d).toBeDefined();
    expect(d?.file).toBe('b.tdsl');
  });

  it('诊断带 file：未知查询链方法定位到所在文件', () => {
    const app = parseProject([
      { path: '01_model.tdsl', content: "@datasource('d')\nentity Order { id: Integer @pk; total: Decimal; }\n" },
      { path: '02_query.tdsl', content: "logic bad(): List<Order> {\n  return Order.where(total > 0).frobnicate();\n}\n" },
    ]);
    const r = check(app);
    expect(r.ok).toBe(false);
    const d = r.diagnostics.find((x) => x.message.includes('查询链无方法'));
    expect(d?.file).toBe('02_query.tdsl');
  });

  it('单文件 parse：诊断 file 为 <stdin>', () => {
    const app = parse("@datasource('d')\nentity Order { id: Integer @pk; total: Decimal; }\nlogic bad(): List<Order> {\n  return Order.where(nofield > 0);\n}\n");
    const r = check(app);
    const d = r.diagnostics.find((x) => x.message.includes('nofield'));
    expect(d?.file).toBe('<stdin>');
  });
});

describe('typecheck FFI 目录（dev/27 Java 一等公民）', () => {
  it('链式 FFI 成员可解析：String 链 ret 传播、List.push（js 同构）不报错', () => {
    const app = check(parse(`
@datasource('defaultDS')
@export
function tag(code0: String): String {
  const a = code0.trim();
  const b = a.toUpperCase();
  const r = new List<String>();
  for (const i of r) {
    r.contains(b);
  }
  return b;
}
`));
    const errs = app.diagnostics.filter((d) => d.severity === 'error');
    expect(errs).toEqual([]);
  });

  it('目录外成员报 error，并附补录口径提示（bundle-jar）', () => {
    const app = check(parse(`
@datasource('defaultDS')
@export
function f(s: String): String {
  return s.frobnicate();
}
`));
    const d = app.diagnostics.find((x) => x.message.includes('不在 FFI 目录'));
    expect(d).toBeDefined();
    expect(d!.message).toContain('bundle-jar');
  });

  it('静态/实例错配报错：实例调静态方法(error) / 静态调静态成员 ✓', () => {
    const errApp = check(parse(`
@datasource('defaultDS')
@export
function f(d: Date): Boolean {
  d.now();
  return true;
}
`));
    const e = errApp.diagnostics.find((x) => x.message.includes('是静态方法'));
    expect(e).toBeDefined();

    const okApp = check(parse(`
@datasource('defaultDS')
@export
function g(): String {
  const y: Date = Date.now();
  const s: String = y.getYear();
  return 'ok';
}
`));
    expect(okApp.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('未知 receiver 宽松放行（M3 之前不收紧）', () => {
    const app = check(parse(`
@datasource('defaultDS')
entity Order { id: Integer @pk; remark: String; }
@export
function f(o: Order): Order {
  const s = o.remark.trim();
  o.save();
  return o;
}
`));
    const errs = app.diagnostics.filter((d) => d.severity === 'error');
    expect(errs).toEqual([]);
  });
});
