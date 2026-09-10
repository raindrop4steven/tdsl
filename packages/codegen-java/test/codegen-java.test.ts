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

describe('codegen-java', () => {
  it('scaffolds spring boot project files', () => {
    const files = generateJava(parse(SAMPLE));
    const names = files.map((f) => f.path);
    expect(names).toContain('pom.xml');
    expect(names).toContain('src/main/java/com/todo/TodoApplication.java');
    expect(names).toContain('src/main/resources/application.yml');
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

  it('translates logic body to service', () => {
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
logic findTodos(): List<Todo> { return Todo.all; }
@export
logic createTodo(input: TodoInput): Todo {
  todo := new Todo();
  todo.title = input.title;
  todo.done = input.done;
  todo.save();
  return todo;
}
@export
logic updateTodo(id: Integer, input: TodoInput): Todo {
  todo := Todo.get(id);
  todo.title = input.title;
  todo.done = input.done;
  todo.save();
  return todo;
}
@export
logic deleteTodo(id: Integer): Boolean {
  todo := Todo.get(id);
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
logic createOrder(input: OrderInput): Order {
  if (input.items.count === 0) { return null; }
  order := new Order();
  order.customer = input.customer;
  order.total = 0;
  order.save();
  for (it in input.items) {
    item := new OrderItem();
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
logic getOrderDetail(id: Integer): OrderDetail {
  order := Order.get(id);
  detail := new OrderDetail();
  detail.order = order;
  detail.items = OrderItem.where(orderId = id);
  return detail;
}
@export
logic deleteOrder(id: Integer): Boolean {
  order := Order.get(id);
  for (it in OrderItem.where(orderId = id)) { it.delete(); }
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
    expect(repo.content).toContain('java.util.List<OrderItem> findByOrderId(Long orderId);');
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
logic listErp(): List<erp.Order> { return erp.Order.all; }
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
logic f(): Order {
  order := new Order();
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
logic createOrder(input: Order): Order {
  return userService.createOrder(input);
}
@export
logic getOrderFromErp(id: Integer): Order {
  return erpApi.getOrder(id);
}
@service(kind = 'dubbo', group = 'order-center', version = '1.0.0')
service UserService {
  createOrder(input: Order): Order;
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

  it('generates dubbo/bean interface files', () => {
    const files = generateJava(parse(M6_DSL));
    const us = files.find((f) => f.path.endsWith('service/api/UserService.java'))!.content;
    expect(us).toContain('public interface UserService');
    expect(us).toContain('Order createOrder(Order input);');
    const sdk = files.find((f) => f.path.endsWith('service/api/OrderSdk.java'))!.content;
    expect(sdk).toContain('public interface OrderSdk');
  });

  it('adds dubbo/bean/http deps to pom.xml', () => {
    const files = generateJava(parse(M6_DSL));
    const pom = files.find((f) => f.path === 'pom.xml')!.content;
    expect(pom).toContain('org.apache.dubbo');
    expect(pom).toContain('<groupId>com.example</groupId>\n      <artifactId>order-sdk</artifactId>');
    expect(pom).toContain('spring-cloud-starter-openfeign');
  });

  it('without services no service deps in pom', () => {
    const files = generateJava(parse(`
entity Order { id: Integer @pk; }
@export
logic listOrders(): List<Order> { return Order.all; }
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
logic inQuery(statuses: List<String>): List<Order> {
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
    expect(repo).toContain('java.util.List<Order> findByCustomerLikeAndTotalGreaterThanEqual(String customer, java.math.BigDecimal total);');
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
    expect(repo).toContain('org.springframework.data.domain.Page<Order> findByTotalGreaterThanOrderByTotalDesc(java.math.BigDecimal total, org.springframework.data.domain.Pageable pageable);');
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
