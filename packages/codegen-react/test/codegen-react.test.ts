import { describe, expect, it } from 'vitest';
import { parse } from '@tdsl/parser';
import { generateReact } from '../src/index';

const SAMPLE = `
@datasource('defaultDS')
entity Todo {
  id: Integer @pk;
  title: String;
  done: Boolean;
}
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

describe('codegen-react', () => {
  it('scaffolds vite project files', () => {
    const files = generateReact(parse(SAMPLE));
    const names = files.map((f) => f.path);
    expect(names).toContain('package.json');
    expect(names).toContain('vite.config.ts');
    expect(names).toContain('tsconfig.json');
    expect(names).toContain('index.html');
    expect(names).toContain('src/main.tsx');
    expect(names).toContain('src/App.tsx');
  });

  it('generates TS types from entity and structure', () => {
    const files = generateReact(parse(SAMPLE));
    const types = files.find((f) => f.path.endsWith('types/index.ts'))!.content;
    expect(types).toContain('export interface Todo');
    expect(types).toContain('id: number;');
    expect(types).toContain('title: string;');
    expect(types).toContain('done: boolean;');
    expect(types).toContain('export interface TodoInput');
  });

  it('generates App.tsx with real CRUD fetch (data-driven)', () => {
    const files = generateReact(parse(SAMPLE));
    const app = files.find((f) => f.path === 'src/App.tsx')!.content;
    expect(app).toContain('http://localhost:8080');
    expect(app).toContain("fetch(API + '/api/todos')");
    expect(app).toContain("method: 'POST'");
    expect(app).toContain("method: 'DELETE'");
    // 列表表单：非主键字段 title/done 生成输入控件
    expect(app).toContain('title');
    expect(app).toContain('done');
  });

  it('generates React17-style main.tsx', () => {
    const files = generateReact(parse(SAMPLE));
    const main = files.find((f) => f.path === 'src/main.tsx')!.content;
    expect(main).toContain("import ReactDOM from 'react-dom';");
    expect(main).toContain('ReactDOM.render');
    expect(main).not.toContain('react-dom/client');
  });

  it('is deterministic', () => {
    const a = generateReact(parse(SAMPLE)).map((f) => f.content).join('\n');
    const b = generateReact(parse(SAMPLE)).map((f) => f.content).join('\n');
    expect(a).toBe(b);
  });
});

describe('codegen-react M4 view', () => {
  const PAGE_DSL = `
@datasource('defaultDS')
entity Order { id: Integer @pk; customer: String; total: Decimal; }
@export
logic listOrders(): List<Order> { return Order.all; }
@export
logic createOrder(input: OrderInput): Order { return new Order(); }
@export
logic getOrderDetail(id: Integer): OrderDetail { return new OrderDetail(); }
@export
logic deleteOrder(id: Integer): Boolean { return true; }
struct OrderInput { customer: String; items: List<OrderItemInput>; }
struct OrderItemInput { product: String; price: Decimal; qty: Integer; }
struct OrderDetail { order: Order; items: List<OrderItem>; }
entity OrderItem { id: Integer @pk; orderId: Integer; product: String; }
interface OrderApi {
  GET    '/api/orders'      -> listOrders
  POST   '/api/orders'      -> createOrder
  GET    '/api/orders/{id}' -> getOrderDetail
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
page OrderCreate {
  <form submit={useMutation('createOrder')}>
    <input field="customer" />
    <repeat field="items">
      <input field="product" />
      <input field="price" />
      <input field="qty" />
    </repeat>
    <button text="提交" />
  </form>
}
page OrderDetail {
  <detail dataSource={useQuery('getOrderDetail', $route.id)}>
    <text field="order.customer" />
  </detail>
}
`;

  it('generates router App.tsx with page routes', () => {
    const files = generateReact(parse(PAGE_DSL));
    const app = files.find((f) => f.path === 'src/App.tsx')!.content;
    expect(app).toContain("import OrderList from './pages/OrderList';");
    expect(app).toContain("<Route path=\"/order-list\" element={<OrderList />} />");
    expect(app).toContain('<Route path="/order-detail/:id" element={<OrderDetail />} />');
  });

  it('generates root path redirect so / is not blank', () => {
    const files = generateReact(parse(PAGE_DSL));
    const app = files.find((f) => f.path === 'src/App.tsx')!.content;
    expect(app).toContain("import { Navigate } from 'react-router-dom';");
    expect(app).toContain('<Route path="/" element={<Navigate to="/order-list" replace />} />');
  });

  it('generates api.ts with fetch wrappers and type imports', () => {
    const files = generateReact(parse(PAGE_DSL));
    const api = files.find((f) => f.path === 'src/api.ts')!.content;
    expect(api).toContain("import type { Order, OrderInput, OrderDetail } from './types';");
    expect(api).toContain('export function listOrders(): Promise<Array<Order>>');
    expect(api).toContain("method: 'DELETE'");
  });

  it('builds path-variable URLs with slash before the var', () => {
    const files = generateReact(parse(PAGE_DSL));
    const api = files.find((f) => f.path === 'src/api.ts')!.content;
    expect(api).toContain("API + '/api/orders/' + id");
  });

  it('generates hooks.ts with useQuery/useMutation', () => {
    const files = generateReact(parse(PAGE_DSL));
    const hooks = files.find((f) => f.path === 'src/hooks.ts')!.content;
    expect(hooks).toContain('export function useQuery');
    expect(hooks).toContain('export function useMutation');
  });

  it('generates page component with query/mutation/navigate hooks', () => {
    const files = generateReact(parse(PAGE_DSL));
    const list = files.find((f) => f.path === 'src/pages/OrderList.tsx')!.content;
    expect(list).toContain("import { useQuery, useMutation } from '../hooks';");
    expect(list).toContain("const qListOrders = useQuery(() => api.listOrders());");
    expect(list).toContain('mDeleteOrder.mutate(row.id)');
    expect(list).toContain("nav('/order-create')");
  });

  it('generates form page with repeat rows and submit mutation', () => {
    const files = generateReact(parse(PAGE_DSL));
    const create = files.find((f) => f.path === 'src/pages/OrderCreate.tsx')!.content;
    expect(create).toContain("import { useMutation } from '../hooks';");
    expect(create).toContain('useState');
    expect(create).toContain("useState<OrderItemInput[]>");
    expect(create).toContain('mCreateOrder.mutate({ customer, items })');
    expect(create).toContain('type="submit"');
  });

  it('generates detail page with $route.id → Number(id)', () => {
    const files = generateReact(parse(PAGE_DSL));
    const detail = files.find((f) => f.path === 'src/pages/OrderDetail.tsx')!.content;
    expect(detail).toContain("import { useParams } from 'react-router-dom';");
    expect(detail).toContain('Number(id)');
    expect(detail).toContain('const { id } = useParams();');
  });

  it('main.tsx wraps BrowserRouter when views exist', () => {
    const files = generateReact(parse(PAGE_DSL));
    const main = files.find((f) => f.path === 'src/main.tsx')!.content;
    expect(main).toContain("import { BrowserRouter } from 'react-router-dom';");
    expect(main).toContain('<BrowserRouter>');
  });

  it('falls back to fixed template when no page declared', () => {
    const files = generateReact(parse(SAMPLE));
    expect(files.some((f) => f.path === 'src/App.tsx' && f.content.includes('管理'))).toBe(true);
  });
});

describe('codegen-react M6 external component', () => {
  it('renders registered component with import and package.json dep', () => {
    const files = generateReact(
      parse(`
entity Order { id: Integer @pk; customer: String; amount: Integer; }
@export
logic listOrders(): List<Order> { return Order.all; }
component ECharts {
  pkg: 'echarts-for-react';
  defaultProps: { option: Json; style: Json };
  events: ['onClick'];
}
page P {
  <ECharts option={null} dataSource={useQuery('listOrders')} />
}
`),
    );
    const page = files.find((f) => f.path === 'src/pages/P.tsx')!.content;
    expect(page).toContain("import ECharts from 'echarts-for-react';");
    expect(page).toContain('<ECharts data={qListOrders.data} option={null} />');
    const pkg = files.find((f) => f.path === 'package.json')!.content;
    expect(pkg).toContain('"echarts-for-react": "*"');
  });
});
