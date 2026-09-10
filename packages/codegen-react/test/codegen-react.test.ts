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
    expect(names).toContain('.npmrc');
    expect(names).toContain('package.json');
    expect(names).toContain('vite.config.ts');
    expect(names).toContain('tsconfig.json');
    expect(names).toContain('index.html');
    expect(names).toContain('src/main.tsx');
    expect(names).toContain('src/App.tsx');
    // 内置 .npmrc 锁定公网 registry（机器上的内网/镜像配置不影响安装）
    expect(files.find((f) => f.path === '.npmrc')!.content).toContain('registry=https://registry.npmjs.org/');
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
    // M10：API base 走 vite dev 代理（相对路径），不再硬编码端口
    expect(app).not.toContain('localhost:8080');
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

  it('injects antd dependency and reset.css when views exist', () => {
    const files = generateReact(parse(PAGE_DSL));
    const pkg = files.find((f) => f.path === 'package.json')!.content;
    expect(pkg).toContain('"antd": "^5.0.0"');
    const main = files.find((f) => f.path === 'src/main.tsx')!.content;
    expect(main).toContain("import 'antd/dist/reset.css';");
  });

  it('generates root path redirect so / is not blank', () => {
    const files = generateReact(parse(PAGE_DSL));
    const app = files.find((f) => f.path === 'src/App.tsx')!.content;
    expect(app).toMatch(/import \{[^}]*Navigate[^}]*\} from 'react-router-dom'/);
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

  it('renders antd Table with data-driven columns', () => {
    const files = generateReact(parse(PAGE_DSL));
    const list = files.find((f) => f.path === 'src/pages/OrderList.tsx')!.content;
    expect(list).toMatch(/import \{[^}]*Table[^}]*\} from 'antd'/);
    expect(list).toMatch(/import \{[^}]*Button[^}]*\} from 'antd'/);
    expect(list).toContain('<Table');
    expect(list).toContain('dataIndex: \'id\'');
    expect(list).toContain('pagination={false}');
    expect(list).toContain('rowKey="id"');
  });

  it('generates form page with repeat rows and submit mutation', () => {
    const files = generateReact(parse(PAGE_DSL));
    const create = files.find((f) => f.path === 'src/pages/OrderCreate.tsx')!.content;
    expect(create).toContain("import { useMutation } from '../hooks';");
    expect(create).toContain('useState');
    expect(create).toContain("useState<OrderItemInput[]>");
    expect(create).toContain('mCreateOrder.mutate({ customer, items })');
    expect(create).toContain('htmlType="submit"');
    expect(create).toMatch(/import \{[^}]*Input[^}]*\} from 'antd'/);
  });

  it('renders detail page with antd Descriptions', () => {
    const files = generateReact(parse(PAGE_DSL));
    const detail = files.find((f) => f.path === 'src/pages/OrderDetail.tsx')!.content;
    expect(detail).toContain('<Descriptions');
    expect(detail).toContain('<Descriptions.Item label="order.customer">');
    expect(detail).toMatch(/import \{[^}]*Descriptions[^}]*\} from 'antd'/);
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

describe('codegen-react 搜索页回归（agent 2026-09 实际踩坑）', () => {
  // 场景：同一逻辑被 button 触发 + table 数据源各绑一次；input 搜索框 + logic 多参数
  const SRC = parse(`
@datasource('defaultDS')
entity Contract { id: Integer @pk; title: String; }
@export
logic searchContracts(keyword: String, page: Integer, size: Integer): List<Contract> { return Contract.all; }
interface ContractApi {
  GET '/api/contracts/search' -> searchContracts
}
page ContractList {
  <input field="keyword" placeholder="搜索合同标题" />
  <button text="搜索" onClick={useQuery('searchContracts', keyword)} />
  <table dataSource={useQuery('searchContracts')}>
    <column field="id" />
  </table>
}
`);
  it('同一逻辑多 binding → 只声明一个 query hook（不重复声明）', () => {
    const page = generateReact(SRC).find((f) => f.path === 'src/pages/ContractList.tsx')!.content;
    expect(page.match(/const qSearchContracts = useQuery/g)?.length).toBe(1);
    expect(page).toContain("useQuery(() => api.searchContracts(keyword))");
    expect(page).toContain('qSearchContracts.refetch()');
  });

  it('页面级 input → keyword state + 受控 Input 接线', () => {
    const page = generateReact(SRC).find((f) => f.path === 'src/pages/ContractList.tsx')!.content;
    expect(page).toContain("import { useState } from 'react';");
    expect(page).toContain("const [keyword, setKeyword] = useState('');");
    expect(page).toContain('<Input placeholder="搜索合同标题" value={keyword} onChange={(e) => setKeyword(e.target.value)} />');
  });

  it('GET 多参 logic 可少传 → api 参数可选 + 条件 query string', () => {
    const api = generateReact(SRC).find((f) => f.path === 'src/api.ts')!.content;
    expect(api).toContain('keyword?: string, page?: number, size?: number');
    expect(api).toContain("if (page !== undefined) qs.push('page=' + encodeURIComponent(String(page)));");
    expect(api).toContain("+ (qs.length ? '?' + qs.join('&') : '')");
  });
});

describe('codegen-react 表单字段类型升级', () => {
  const SRC = parse(`
@datasource('defaultDS')
entity Contract { id: Integer @pk; title: String; type: ContractType; amount: Decimal; signDate: Date; createdAt: DateTime; }
enum ContractType { DRAFT, ACTIVE }
struct ContractInput { title: String; type: ContractType; amount: Decimal; signDate: Date; createdAt: DateTime; }
@export
logic createContract(input: ContractInput): Contract { return new Contract(); }
interface ContractApi {
  POST '/api/contracts' -> createContract
}
page ContractForm {
  <form submit={useMutation('createContract')}>
    <input field="title" />
    <input field="type" />
    <input field="amount" />
    <input field="signDate" />
    <input field="createdAt" />
  </form>
}
`);
  it('表单字段类型升级：枚举字段→Select（选项来自 enum 项）；数字→InputNumber；日期→DatePicker；DateTime 带 showTime；submit 自动补 Button import', () => {
    const page = generateReact(SRC).find((f) => f.path === 'src/pages/ContractForm.tsx')!.content;
    expect(page).toContain(`<Select style={{ width: '100%' }} options={[{ value: 'DRAFT', label: 'DRAFT' }, { value: 'ACTIVE', label: 'ACTIVE' }]}`);
    expect(page).toContain('<InputNumber');
    expect(page).toContain('<DatePicker style={{ width: \'100%\' }} value={signDate ? dayjs(signDate) : null}');
    expect(page).toContain('<DatePicker showTime');
    // genForm 自产的提交按钮 → Button 必须在 import 中（否则 ReferenceError: Button is not defined）
    expect(page).toMatch(/import \{ [^}]*Button[^}]*\} from 'antd'/);
  });

  it('页面 import 含升级控件与 dayjs；package.json 含 dayjs 依赖；提交走 onSubmit + htmlType=submit', () => {
    const files = generateReact(SRC);
    const page = files.find((f) => f.path === 'src/pages/ContractForm.tsx')!.content;
    expect(page).toMatch(/import \{ [^}]*Select[^}]*\} from 'antd'/);
    expect(page).toMatch(/import \{ [^}]*InputNumber[^}]*\} from 'antd'/);
    expect(page).toMatch(/import \{ [^}]*DatePicker[^}]*\} from 'antd'/);
    expect(page).toContain("import dayjs from 'dayjs';");
    expect(page).toContain('htmlType="submit"');
    const pkg = files.find((f) => f.path === 'package.json')!.content;
    expect(pkg).toContain('"dayjs": "^1.11.0"');
  });
});

describe('codegen-react dialog（右侧抽屉）', () => {
  const SRC = parse(`
@datasource('defaultDS')
entity Car { id: Integer @pk; plate: String; status: CarStatus; }
enum CarStatus { DRAFT, ACTIVE }
struct CarInput { plate: String; status: CarStatus; }
@export
logic listCars(): List<Car> { return Car.all; }
@export
logic saveCar(input: CarInput): Car { return new Car(); }
interface CarApi {
  GET '/api/cars'        -> listCars
  POST  '/api/cars'      -> saveCar
}
page CarList {
  <button text="新增车辆" onClick={openDialog('CarForm')} />
  <table dataSource={useQuery('listCars')}><column field="plate" /></table>
}
dialog CarForm {
  <form submit={useMutation('saveCar')}>
    <input field="plate" />
  </form>
}
`);
  it('dialog 页面：Drawer 组件 + open/onClose props + 提交成功自动关闭', () => {
    const files = generateReact(SRC);
    const form = files.find((f) => f.path === 'src/pages/CarForm.tsx')!.content;
    expect(form).toMatch(/import \{[^}]*Drawer[^}]*\} from 'antd'/);
    expect(form).toContain('function CarForm({ open, onClose }: { open: boolean; onClose: () => void })');
    expect(form).toContain('<Drawer title="CarForm" open={open} onClose={onClose} width={560}');
    expect(form).toContain('.then(() => onClose())');
  });

  it('父页面：openDialog 按钮 onClick 开抽屉；关闭时自动 refetch 列表', () => {
    const files = generateReact(SRC);
    const list = files.find((f) => f.path === 'src/pages/CarList.tsx')!.content;
    expect(list).toContain('const [showCarForm, setShowCarForm] = useState(false);');
    expect(list).toContain("onClick={() => setShowCarForm(true)}");
    expect(list).toContain("<CarForm open={showCarForm} onClose={() => { setShowCarForm(false); qListCars.refetch(); }} />");
    expect(list).toContain("import CarForm from './CarForm';");
  });

  it('dialog 不进路由与菜单（不作为首页）', () => {
    const app = generateReact(SRC).find((f) => f.path === 'src/App.tsx')!.content;
    expect(app).toContain('<Route path="/car-list" element={<CarList />} />');
    expect(app).not.toContain('<Route path="/car-form"');
    expect(app).not.toContain("label: 'CarForm'");
  });
});
