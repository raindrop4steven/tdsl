import { describe, expect, it } from 'vitest';
import { parse } from '@tdsl/parser';
import { generateJava } from '../src/index';

const SAMPLE = `
@datasource('defaultDS')
entity Todo {
  id: Integer @pk;
  title: String;
  done: Boolean;
}

@export
function findTodos(): List<Todo> {
  const result = new List<Todo>();
  for (const todo of Todo.all) {
    if (todo.done === false) {
      result.add(todo);
    }
  }
  return result;
}
`;

describe('codegen-java', () => {
  it('scaffolds spring boot project files', () => {
    const files = generateJava(parse(SAMPLE));
    const names = files.map((f) => f.path);
    expect(names).toContain('pom.xml');
    expect(names).toContain('src/main/java/com/todo/TodoApplication.java');
    expect(names).toContain('src/main/resources/application.yml');
    // M10 运行回路：脚手架自带探针端点 + 端口参数化
    expect(names).toContain('src/main/java/com/todo/HealthController.java');
    const health = files.find((f) => f.path.endsWith('HealthController.java'))!.content;
    expect(health).toContain('@GetMapping("/healthz")');
    const yml = files.find((f) => f.path === 'src/main/resources/application.yml')!.content;
    expect(yml).toContain('TDSL_BACKEND_PORT');
    expect(yml).toContain('ddl-auto: update');
  });

  it('generates JPA entity with getters/setters', () => {
    const files = generateJava(parse(SAMPLE));
    const entity = files.find((f) => f.path.endsWith('entity/Todo.java'))!.content;
    expect(entity).toContain('@Entity');
    expect(entity).toContain('@Table(name = "todo")');
    expect(entity).toContain('@Id');
    expect(entity).toContain('private Long id;');
    expect(entity).toContain('private Boolean done;');
    expect(entity).toContain('public String getTitle()');
    expect(entity).toContain('public void setTitle(String title)');
  });

  it('generates repository per entity', () => {
    const files = generateJava(parse(SAMPLE));
    const repo = files.find((f) => f.path.endsWith('repository/TodoRepository.java'))!.content;
    expect(repo).toContain('public interface TodoRepository extends JpaRepository<Todo, Long>');
  });

  it('translates function body to service', () => {
    const files = generateJava(parse(SAMPLE));
    const svc = files.find((f) => f.path.endsWith('service/FindTodosService.java'))!.content;
    expect(svc).toContain('@Service');
    expect(svc).toContain('public class FindTodosService');
    expect(svc).toContain('private final TodoRepository todoRepository;');
    expect(svc).toContain('todoRepository.findAll()');
    expect(svc).toContain('todo.getDone() == false');
    expect(svc).toContain('result.add(todo)');
    expect(svc).toContain('return result;');
  });

  it('is deterministic: same input → same output', () => {
    const a = generateJava(parse(SAMPLE)).map((f) => f.content).join('\n');
    const b = generateJava(parse(SAMPLE)).map((f) => f.content).join('\n');
    expect(a).toBe(b);
  });
});

const CRUD = `
@datasource('defaultDS')
entity Todo {
  id: Integer @pk;
  title: String;
  done: Boolean;
}
struct TodoInput { title: String; done: Boolean; }

@export
function findTodos(): List<Todo> { return Todo.all; }
@export
function createTodo(input: TodoInput): Todo {
  const todo = new Todo();
  todo.title = input.title;
  todo.done = input.done;
  todo.save();
  return todo;
}
@export
function updateTodo(id: Integer, input: TodoInput): Todo {
  const todo = Todo.get(id);
  todo.title = input.title;
  todo.done = input.done;
  todo.save();
  return todo;
}
@export
function deleteTodo(id: Integer): Boolean {
  const todo = Todo.get(id);
  todo.delete();
  return true;
}

interface TodoApi {
  GET    '/api/todos'       -> findTodos
  POST   '/api/todos'       -> createTodo
  PUT    '/api/todos/{id}'  -> updateTodo
  DELETE '/api/todos/{id}'  -> deleteTodo
}
`;

describe('codegen-java CRUD', () => {
  it('generates structure POJO', () => {
    const files = generateJava(parse(CRUD));
    const struct = files.find((f) => f.path.endsWith('structure/TodoInput.java'))!.content;
    expect(struct).toContain('public class TodoInput');
    expect(struct).toContain('private String title;');
    expect(struct).toContain('public String getTitle()');
  });

  it('generates service with params', () => {
    const files = generateJava(parse(CRUD));
    const svc = files.find((f) => f.path.endsWith('service/CreateTodoService.java'))!.content;
    expect(svc).toContain('public Todo createTodo(TodoInput input)');
    expect(svc).toContain('todo.setTitle(input.getTitle())');
    expect(svc).toContain('todoRepository.save(todo)');
  });

  it('maps entity methods to repository', () => {
    const files = generateJava(parse(CRUD));
    const upd = files.find((f) => f.path.endsWith('service/UpdateTodoService.java'))!.content;
    expect(upd).toContain('todoRepository.findById(id).orElseThrow()');
    const del = files.find((f) => f.path.endsWith('service/DeleteTodoService.java'))!.content;
    expect(del).toContain('todoRepository.delete(todo)');
  });

  it('generates controller with REST mappings', () => {
    const files = generateJava(parse(CRUD));
    const ctrl = files.find((f) => f.path.endsWith('controller/TodoApiController.java'))!.content;
    expect(ctrl).toContain('@RestController');
    expect(ctrl).toContain('@CrossOrigin');
    expect(ctrl).toContain('@GetMapping("/api/todos")');
    expect(ctrl).toContain('@PostMapping("/api/todos")');
    expect(ctrl).toContain('@PutMapping("/api/todos/{id}")');
    expect(ctrl).toContain('@DeleteMapping("/api/todos/{id}")');
    expect(ctrl).toContain('@PathVariable Long id');
    expect(ctrl).toContain('@RequestBody TodoInput input');
    expect(ctrl).toContain('findTodosService.findTodos()');
    expect(ctrl).toContain('createTodoService.createTodo(input)');
  });
});
describe('codegen-java order scenario', () => {
  const ORDER_DSL = `
@datasource('defaultDS')
entity Order {
  id: Integer @pk;
  customer: String;
  total: Decimal;
}
entity OrderItem {
  id: Integer @pk;
  orderId: Integer;
  product: String;
  price: Decimal;
  qty: Integer;
}
struct OrderInput { customer: String; items: List<OrderItemInput>; }
struct OrderItemInput { product: String; price: Decimal; qty: Integer; }
struct OrderDetail { order: Order; items: List<OrderItem>; }
@export
function createOrder(input: OrderInput): Order {
  if (input.items.count === 0) { return null; }
  const order = new Order();
  order.customer = input.customer;
  order.total = 0;
  order.save();
  for (const it of input.items) {
    const item = new OrderItem();
    item.orderId = order.id;
    item.product = it.product;
    item.price = it.price;
    item.qty = it.qty;
    item.save();
    order.total = order.total + it.price * it.qty;
  }
  order.save();
  return order;
}
@export
function getOrderDetail(id: Integer): OrderDetail {
  const order = Order.get(id);
  const detail = new OrderDetail();
  detail.order = order;
  detail.items = OrderItem.where(orderId = id);
  return detail;
}
@export
function deleteOrder(id: Integer): Boolean {
  const order = Order.get(id);
  for (const it of OrderItem.where(orderId = id)) { it.delete(); }
  order.delete();
  return true;
}
interface OrderApi {
  GET    '/api/orders'      -> getOrderDetail
  POST   '/api/orders'      -> createOrder
  GET    '/api/orders/{id}' -> getOrderDetail
  DELETE '/api/orders/{id}' -> deleteOrder
}
`;

  it('generates @Transactional on write service', () => {
    const files = generateJava(parse(ORDER_DSL));
    const create = files.find((f) => f.path.endsWith('service/CreateOrderService.java'))!;
    expect(create.content).toContain('@Transactional');
    expect(create.content).toContain('import org.springframework.transaction.annotation.Transactional;');
    const detail = files.find((f) => f.path.endsWith('service/GetOrderDetailService.java'))!;
    expect(detail.content).not.toContain('@Transactional'); // 只读不标事务
  });

  it('generates where-derived findBy in repository', () => {
    const files = generateJava(parse(ORDER_DSL));
    const repo = files.find((f) => f.path.endsWith('repository/OrderItemRepository.java'))!;
    expect(repo.content).toContain('findByOrderId(@org.springframework.data.repository.query.Param("orderId") Long orderId);');
  });

  it('generates Decimal arithmetic (add/multiply) not Java operators', () => {
    const files = generateJava(parse(ORDER_DSL));
    const create = files.find((f) => f.path.endsWith('service/CreateOrderService.java'))!.content;
    expect(create).toContain('.add(');
    expect(create).toContain('.multiply(');
    expect(create).toContain('BigDecimal.valueOf');
  });

  it('quotes SQL-reserved table name (order)', () => {
    const files = generateJava(parse(ORDER_DSL));
    const order = files.find((f) => f.path.endsWith('entity/Order.java'))!.content;
    expect(order).toContain('@Table(name = "\\"order\\"")');
  });

  it('imports structure in service for return type', () => {
    const files = generateJava(parse(ORDER_DSL));
    const detail = files.find((f) => f.path.endsWith('service/GetOrderDetailService.java'))!.content;
    expect(detail).toContain('import com.todo.structure.*;');
    expect(detail).toContain('orderItemRepository.findByOrderId(id)');
  });
});

describe('codegen-java M1 namespace', () => {
  it('generates distinct repos/entities for same-name entities across datasources', () => {
    const files = generateJava(parse(`
@datasource('erp')
entity Order { id: Integer @pk; erpNo: String; }
@datasource('crm')
entity Order { id: Integer @pk; customer: String; }
@export
function listErp(): List<erp.Order> { return erp.Order.all; }
`));
    const erpEntity = files.find((f) => f.path.endsWith('entity/Order.java'))!;
    expect(erpEntity.content).toContain('erpNo');
    const erpRepo = files.find((f) => f.path.endsWith('repository/OrderRepository.java'))!;
    expect(erpRepo.content).toContain('JpaRepository<Order, Long>');
    // Service 引用 erp.Order.all → erp 的 OrderRepository
    const svc = files.find((f) => f.path.endsWith('service/ListErpService.java'))!;
    expect(svc.content).toContain('orderRepository.findAll()');
  });

  it('reuses outer variable in nested block (Java semantics, no shadowing)', () => {
    const files = generateJava(parse(`
entity Order { id: Integer @pk; total: Decimal; }
@export
function f(): Order {
  const order = new Order();
  order.total = 0;
  if (true) {
    order.total = 1;
    order.total = order.total + 5;
  }
  order.save();
  return order;
}
`));
    const svc = files.find((f) => f.path.endsWith('service/FService.java'))!.content;
    // 嵌套块内同名 order := 复用外层（生成赋值，不重复声明 Order 类型）
    expect(svc).toContain('Order order = new Order();');
    expect(svc.match(/Order order = /g)).toHaveLength(1);
  });
});

describe('codegen-java M6 external service', () => {
  const M6_DSL = `
entity Order { id: Integer @pk; customer: String; }
@export
function createOrder(input: Order): Order {
  return userService.createOrder(input);
}
@export
function getOrderFromErp(id: Integer): Order {
  return erpApi.getOrder(id);
}
@service(kind = 'dubbo', group = 'order-center', version = '1.0.0')
service UserService {
  createOrder(input: Order): Order;
}
@service(kind = 'http', baseUrl = 'http://erp-center')
service ErpApi {
  GET '/api/orders/{id}' -> getOrder(id: Integer): Order;
}
interface OrderApi {
  POST '/api/orders' -> createOrder
}
`;

  it('injects dubbo service via @DubboReference', () => {
    const files = generateJava(parse(M6_DSL));
    const svc = files.find((f) => f.path.endsWith('service/CreateOrderService.java'))!.content;
    expect(svc).toContain('import org.apache.dubbo.config.annotation.DubboReference;');
    expect(svc).toContain('@DubboReference(group = "order-center", version = "1.0.0")');
    expect(svc).toContain('private UserService userService;');
    expect(svc).toContain('import com.todo.service.api.*;');
  });

  it('injects http service via @Autowired + generates Feign interface', () => {
    const files = generateJava(parse(M6_DSL));
    const svc = files.find((f) => f.path.endsWith('service/GetOrderFromErpService.java'))!.content;
    expect(svc).toContain('import org.springframework.beans.factory.annotation.Autowired;');
    expect(svc).toContain('private ErpApi erpApi;');
    // Feign 接口文件
    const erp = files.find((f) => f.path.endsWith('service/api/ErpApi.java'))!.content;
    expect(erp).toContain('@FeignClient(name = "erpapi", url = "http://erp-center")');
    expect(erp).toContain('@GetMapping("/api/orders/{id}")');
    expect(erp).toContain('Order getOrder(Long id);');
  });

  it('generates dubbo interface files', () => {
    const files = generateJava(parse(M6_DSL));
    const us = files.find((f) => f.path.endsWith('service/api/UserService.java'))!.content;
    expect(us).toContain('public interface UserService');
    expect(us).toContain('Order createOrder(Order input);');
  });

  it('adds dubbo/http deps to pom.xml', () => {
    const files = generateJava(parse(M6_DSL));
    const pom = files.find((f) => f.path === 'pom.xml')!.content;
    expect(pom).toContain('org.apache.dubbo');
    expect(pom).toContain('spring-cloud-starter-openfeign');
    // bean(jar) 坐标注入已删除（dev/33）：本地 jar 走 dependency java 声明
    expect(pom).not.toContain('order-sdk');
  });

  it('without services no service deps in pom', () => {
    const files = generateJava(parse(`
entity Order { id: Integer @pk; }
@export
function listOrders(): List<Order> { return Order.all; }
interface OrderApi { GET '/api/orders' -> listOrders }
`));
    const pom = files.find((f) => f.path === 'pom.xml')!.content;
    expect(pom).not.toContain('dubbo');
    expect(pom).not.toContain('openfeign');
  });
});

describe('codegen-java M2 查询语言', () => {
  const M2_DSL = `
@datasource('d')
entity Order {
  id: Integer @pk;
  customer: String;
  total: Decimal;
  status: String;
}
@export
function searchOrders(customer: String, minTotal: Decimal): List<Order> {
  return Order.where(customer like '%' + customer + '%', total >= minTotal);
}
function topOrders(): List<Order> {
  return Order.where(total > 0).orderBy(total desc).limit(10);
}
function pageOrders(n: Integer, size: Integer): Page<Order> {
  return Order.where(total > 0).orderBy(total desc).page(n, size);
}
function orderStats(): Decimal {
  return Order.aggregate(sum(total));
}
function sumByCustomer(): List<Map<Object>> {
  return Order.aggregate(sum(total)).groupBy(customer);
}
function inQuery(statuses: List<String>): List<Order> {
  return Order.where(status in statuses);
}
interface OrderApi {
  GET '/api/orders/search' -> searchOrders
  GET '/api/orders/top'    -> topOrders
  GET '/api/orders/page'   -> pageOrders
  GET '/api/orders/stats'  -> orderStats
}
`;

  it('derives multi-condition AND method name with op suffixes', () => {
    const files = generateJava(parse(M2_DSL));
    const repo = files.find((f) => f.path.endsWith('repository/OrderRepository.java'))!.content;
    expect(repo).toContain('findByCustomerLikeAndTotalGreaterThanEqual(@org.springframework.data.repository.query.Param("customer") String customer, @org.springframework.data.repository.query.Param("total") java.math.BigDecimal total);');
  });

  it('generates limit() with Pageable returning List', () => {
    const files = generateJava(parse(M2_DSL));
    const repo = files.find((f) => f.path.endsWith('repository/OrderRepository.java'))!.content;
    expect(repo).toContain('java.util.List<Order> findTop10ByTotalGreaterThanOrderByTotalDesc(java.math.BigDecimal total, org.springframework.data.domain.Pageable pageable);');
    const svc = files.find((f) => f.path.endsWith('service/TopOrdersService.java'))!.content;
    expect(svc).toContain('PageRequest.of(0, 10)');
  });

  it('generates page() returning Page<T> with Pageable', () => {
    const files = generateJava(parse(M2_DSL));
    const repo = files.find((f) => f.path.endsWith('repository/OrderRepository.java'))!.content;
    expect(repo).toContain('org.springframework.data.domain.Page<Order> findByTotalGreaterThanOrderByTotalDesc(@org.springframework.data.repository.query.Param("total") java.math.BigDecimal total, org.springframework.data.domain.Pageable pageable);');
    const svc = files.find((f) => f.path.endsWith('service/PageOrdersService.java'))!.content;
    expect(svc).toContain('PageRequest.of(n.intValue(), size.intValue())');
    expect(svc).toContain('org.springframework.data.domain.Page<Order> pageOrders(');
  });

  it('generates @Query aggregate scalar (sum)', () => {
    const files = generateJava(parse(M2_DSL));
    const repo = files.find((f) => f.path.endsWith('repository/OrderRepository.java'))!.content;
    expect(repo).toContain('@org.springframework.data.jpa.repository.Query("SELECT SUM(o.total) FROM Order o")');
    expect(repo).toContain('java.math.BigDecimal sumTotal();');
    const svc = files.find((f) => f.path.endsWith('service/OrderStatsService.java'))!.content;
    expect(svc).toContain('orderRepository.sumTotal()');
  });

  it('generates @Query groupBy returning List<Object[]> and Service assembles Map', () => {
    const files = generateJava(parse(M2_DSL));
    const repo = files.find((f) => f.path.endsWith('repository/OrderRepository.java'))!.content;
    expect(repo).toContain('@org.springframework.data.jpa.repository.Query("SELECT o.customer, SUM(o.total) FROM Order o GROUP BY o.customer")');
    expect(repo).toContain('java.util.List<Object[]> sumTotalByCustomer();');
    const svc = files.find((f) => f.path.endsWith('service/SumByCustomerService.java'))!.content;
    expect(svc).toContain('java.util.List<java.util.Map<String, Object>> sumByCustomer()');
    expect(svc).toContain('m.put("customer", row[0]);');
    expect(svc).toContain('m.put("sum(total)", row[1]);');
    expect(svc).toContain('orderRepository.sumTotalByCustomer()');
  });

  it('maps Page type in service return (javaType Page branch)', () => {
    const files = generateJava(parse(M2_DSL));
    const svc = files.find((f) => f.path.endsWith('service/PageOrdersService.java'))!.content;
    expect(svc).toContain('org.springframework.data.domain.Page<Order> pageOrders(');
    const ctl = files.find((f) => f.path.endsWith('controller/OrderApiController.java'))!.content;
    expect(ctl).toContain('org.springframework.data.domain.Page<Order> pageOrders(');
  });

  it('generates in-condition with Collection param', () => {
    const files = generateJava(parse(M2_DSL));
    const repo = files.find((f) => f.path.endsWith('repository/OrderRepository.java'))!.content;
    expect(repo).toContain('java.util.List<Order> findByStatusIn(java.util.Collection<String> status);');
  });
});

describe('codegen-java M7 多文件工程', () => {
  it('app 名非法时抛清晰错误（app 名参数化防御）', () => {
    const app = parse("@datasource('d')\nentity Order { id: Integer @pk; total: Decimal; }");
    app.name = 'todo-multi';
    expect(() => generateJava(app)).toThrow(/not a valid Java identifier/);
  });

  it('app 名参数化：包名/groupId/类名跟随', () => {
    const app = parse("@datasource('d')\nentity Order { id: Integer @pk; total: Decimal; }");
    app.name = 'todomulti';
    const files = generateJava(app);
    const pom = files.find((f) => f.path === 'pom.xml')!.content;
    expect(pom).toContain('<groupId>com.todomulti</groupId>');
    expect(pom).toContain('<artifactId>todomulti-app</artifactId>');
    const main = files.find((f) => f.path.endsWith('TodomultiApplication.java'))!;
    expect(main.path).toBe('src/main/java/com/todomulti/TodomultiApplication.java');
  });
});

// ---------- jxc spec 对拍暴露的缺陷回归（List<struct> import / Decimal 比较 / Integer 累加器） ----------

describe('codegen-java spec 对拍修复（jxc）', () => {
  const SRC = parse(`
@datasource('defaultDS')
struct Row { code: String; qty: Integer; }
entity Item { id: Integer @pk; orderId: Integer; qty: Integer; price: Decimal; }
entity Head { id: Integer @pk; amount: Decimal; }
@export
function summary(): List<Row> {
  const rows = new List<Row>();
  const r = new Row();
  rows.add(r);
  return rows;
}
@export
function adjust(id: Integer, amount: Decimal): Boolean {
  const h = Head.get(id);
  if (h.amount >= amount) {
    h.amount = h.amount - amount;
    h.save();
  }
  return true;
}
@export
function tally(id: Integer): Integer {
  const n = 0;
  for (const it of Item.where(orderId = id)) {
    n = n + it.qty;
  }
  return n;
}
interface Api {
  GET  '/api/summary' -> summary
  POST '/api/adjust'  -> adjust
  POST '/api/tally'   -> tally
}
`);
  it('List<struct> 作返回值 → Service 补 structure.* import（泛型实参中的结构引用此前漏收集）', () => {
    const svc = generateJava(SRC).find((f) => f.path.endsWith('SummaryService.java'))!.content;
    expect(svc).toContain('import com.todo.structure.*;');
  });

  it('logic 体内 Decimal 比较 → compareTo（BigDecimal 无运算符重载，此前直出 >= 编译错）', () => {
    const svc = generateJava(SRC).find((f) => f.path.endsWith('AdjustService.java'))!.content;
    expect(svc).toContain('.compareTo(');
    expect(svc).toMatch(/>= 0\)/);
    expect(svc).toContain('.subtract(');
  });

  it('整数字面量 := 累加器 → long（实体 Integer 字段 getter 为 Long，int+long 精度损失编译错）', () => {
    const svc = generateJava(SRC).find((f) => f.path.endsWith('TallyService.java'))!.content;
    expect(svc).toContain('long n = 0L;');
  });

  it('无枚举 app → 不发射 enums wildcard import（enums 包目录不存在，javac 找不到包；slice:multi 回归）', () => {
    const svc = generateJava(SRC).find((f) => f.path.endsWith('TallyService.java'))!.content;
    expect(svc).not.toContain('import com.todo.enums.*;');
  });

  it('where 查询 null 宽松：eq/like 条件 → JPQL（:field IS NULL OR 谓词 + @Param），方法名不变（jxc F9：可选参数缺省默认全量而非空集）', () => {
    const repo = generateJava(SRC).find((f) => f.path.endsWith('ItemRepository.java'))!.content;
    expect(repo).toContain('IS NULL OR');
    expect(repo).toContain('findByOrderId');
  });
});

  it('Java enum 带 label 构造器与 getter（G1 中文字典）', () => {
    const src = parse(`
@datasource('defaultDS')
enum SettleMode { CASH('现金'), ACCOUNT('对账') }
entity E { id: Integer @pk; mode: SettleMode; }
`);
    const ef = generateJava(src).find((f) => f.path.endsWith('SettleMode.java'))!.content;
    expect(ef).toContain('CASH("现金"),');
    expect(ef).toContain('public String getLabel()');
  });

  it('throw 语句 → 框架 TdslError + advice 文件（dev/30 A1）', () => {
    const src = parse(`
@datasource('defaultDS')
@export
function checkIt(x: Integer): Boolean {
  if (x === 0) {
    throw 'x 不能为 0';
  }
  return true;
}
interface Api {
  POST '/api/check' -> checkIt
}
`);
    const files = generateJava(src);
    const svc = files.find((f) => f.path.endsWith('CheckItService.java'))!.content;
    expect(svc).toContain('throw new com.todo.support.TdslError("x 不能为 0")');
    expect(files.find((f) => f.path.endsWith('TdslError.java'))).toBeDefined();
    expect(files.find((f) => f.path.endsWith('GlobalAdvice.java'))!.content).toContain('@RestControllerAdvice');
  });

describe('codegen-java dev/32 依赖声明驱动 pom', () => {
  it('dependency java 声明 → pom <dependencies>（版本缺省取产物坐标）', () => {
    const files = generateJava(parse(`
dependency java "com.alibaba:fastjson2";
dependency java "com.other:lib:1.2.3";
@export
function f(): Boolean { return true; }
`), { libs: [{ eco: 'java', coordinate: 'com.alibaba:fastjson2:2.0.58', classes: [] }] });
    const pom = files.find((f) => f.path === 'pom.xml')!.content;
    expect(pom).toContain('<groupId>com.alibaba</groupId>');
    expect(pom).toContain('<artifactId>fastjson2</artifactId>');
    expect(pom).toContain('<version>2.0.58</version>');
    expect(pom).toContain('<artifactId>lib</artifactId>');
    expect(pom).toContain('<version>1.2.3</version>');
  });

  it('无依赖声明 → pom 无第三方依赖（不再从目录反推）', () => {
    const files = generateJava(parse(`
@export
function f(o: Object): String { return JSON.toJSONString(o); }
`), { libs: [{
      eco: 'java',
      coordinate: 'com.alibaba:fastjson2:2.0.58',
      classes: [{ class: 'com.alibaba.fastjson2.JSON', alias: 'JSON', members: [{ name: 'toJSONString', static: true, params: ['Object'], ret: 'String', java: 'com.alibaba.fastjson2.JSON.toJSONString({0})' }] }],
    }] });
    const pom = files.find((f) => f.path === 'pom.xml')!.content;
    expect(pom).not.toContain('fastjson2');
  });

  it('依赖产物类 import 走 FQN（service 文件）', () => {
    const files = generateJava(parse(`
dependency java "com.alibaba:fastjson2:2.0.58";
@export
function f(o: Object): String { return JSON.toJSONString(o); }
`), { libs: [{
      eco: 'java',
      coordinate: 'com.alibaba:fastjson2:2.0.58',
      classes: [{ class: 'com.alibaba.fastjson2.JSON', alias: 'JSON', members: [{ name: 'toJSONString', static: true, params: ['Object'], ret: 'String', java: 'com.alibaba.fastjson2.JSON.toJSONString({0})' }] }],
    }] });
    const svc = files.find((f) => f.path.includes('service') && f.content.includes('toJSONString'))!;
    expect(svc.content).toContain('import com.alibaba.fastjson2.JSON;');
  });

  // dev/40 芋道对拍批次修复回归：4 个真机编译错误（count 字段 getter / Decimal 除法 / Long 字面量 L / BigDecimal 中间变量）
  const YUDAO_BATCH = `
@datasource('yudaoDS')
entity Stock {
  id: Integer @pk;
  count: Decimal;
}
entity StockRecord {
  id: Integer @pk;
  productId: Integer;
  totalCount: Decimal;
}
entity Contract {
  id: Integer @pk;
  totalProductPrice: Decimal;
  discountPercent: Decimal;
}
entity OrderItem {
  id: Integer @pk;
  count: Decimal;
}
entity Todo {
  id: Integer @pk;
  status: Integer;
  completed: Integer;
}
struct ItemInput { productId: Integer; count: Decimal; }
struct StockRecordInput { productId: Integer; count: Decimal; }
@export
function stockIn(input: StockRecordInput): StockRecord {
  const stock = Stock.get(input.productId);
  const total = stock.count + input.count;
  stock.count = total;
  stock.save();
  return null;
}
@export
function saveItems(items: List<ItemInput>): Boolean {
  if (items.count === 0) { return false; }
  for (const it of items) {
    const item = new OrderItem();
    item.count = it.count;
    item.save();
  }
  return true;
}
@export
function calcDiscount(c: Contract): Decimal {
  const total = c.totalProductPrice * c.discountPercent / 100;
  return total;
}
@export
function markDone(id: Integer): Boolean {
  const t = Todo.get(id);
  t.completed = 1;
  t.status = 0;
  t.save();
  return true;
}
`;

  it('结构体 count 字段 → getter；List.count → .size()（类型感知，不再误翻 size）', () => {
    const files = generateJava(parse(YUDAO_BATCH));
    const svc = files.find((f) => f.path.endsWith('service/SaveItemsService.java'))!.content;
    expect(svc).toContain('item.setCount(it.getCount());');
    expect(svc).toContain('(items.size() == 0)');
    const stockSvc = files.find((f) => f.path.endsWith('service/StockInService.java'))!.content;
    expect(stockSvc).toContain('stock.setCount(total);');
  });

  it('Decimal 除法 → divide(scale 2, HALF_UP)；/ 推导为 BigDecimal', () => {
    const files = generateJava(parse(YUDAO_BATCH));
    const svc = files.find((f) => f.path.endsWith('service/CalcDiscountService.java'))!.content;
    expect(svc).toContain('java.math.BigDecimal total = ((c.getTotalProductPrice().multiply(c.getDiscountPercent())).divide(java.math.BigDecimal.valueOf(100), 2, java.math.RoundingMode.HALF_UP));');
  });

  it('BigDecimal 中间变量（total = a + b）推导类型，不再价值双重 valueOf', () => {
    const files = generateJava(parse(YUDAO_BATCH));
    const svc = files.find((f) => f.path.endsWith('service/StockInService.java'))!.content;
    expect(svc).toContain('java.math.BigDecimal total = (stock.getCount().add(input.getCount()));');
    expect(svc).not.toContain('BigDecimal.valueOf(total)');
  });

  it('Long 字段赋整数字面量 → L 后缀（int 无法转 Long）', () => {
    const files = generateJava(parse(YUDAO_BATCH));
    const svc = files.find((f) => f.path.endsWith('service/MarkDoneService.java'))!.content;
    expect(svc).toContain('t.setCompleted(1L);');
    expect(svc).toContain('t.setStatus(0L);');
  });

  it('dev/48：条件聚合 where(...).aggregate(count()) → JPQL WHERE + named 参数', () => {
    const src = parse(`
@datasource('defaultDS')
entity Order { id: Integer @pk; status: String; total: Decimal; }
@export
function countPending(): Integer { return Order.where(status = 'X').aggregate(count()); }
@export
function sumAll(): Decimal { return Order.aggregate(sum(total)); }
`);
    const repo = generateJava(src).find((f) => f.path.endsWith('OrderRepository.java'))!.content;
    expect(repo).toContain(
      '@org.springframework.data.jpa.repository.Query("SELECT COUNT(o) FROM Order o WHERE (:status IS NULL OR o.status = :status)")',
    );
    expect(repo).toContain('Long countAllByStatus(@org.springframework.data.repository.query.Param("status") String status);');
    expect(repo).toContain('@org.springframework.data.jpa.repository.Query("SELECT SUM(o.total) FROM Order o")');
    expect(repo).toContain('java.math.BigDecimal sumTotal();');
    const svc = generateJava(src).find((f) => f.path.endsWith('CountPendingService.java'))!.content;
    expect(svc).toContain('return orderRepository.countAllByStatus("X");');
  });
});
