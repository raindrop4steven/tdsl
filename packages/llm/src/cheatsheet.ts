/**
 * 语法速查（Prompt Pack ②层，~400 token "围栏"）。
 * 只写形态不写语义——语义靠示例矩阵承载；偏离点显式警告（LLM 最易犯"把 TDSL 写成 TS"）。
 * 语法演进时此表与 parser 变更绑定检查（PR checklist 项），并跑 examples 可编译性单测兜底。
 */
export const SYNTAX_CHEATSHEET = `// ===== TDSL 语法速查（形态一览，语义见示例）=====

// ---- 声明（领域扩展，TS 无对应）----
@datasource('dsName')        // 独立顶层语句（非实体修饰符）：声明/切换当前数据源，此后 entity 归入它直到下一次切换；跨源同名实体引用用 dsName.Entity
entity Order { id: Integer @pk; total: Decimal; createdAt: DateTime }  // 注解: @pk @nullable @unique
struct OrderInput { items: List<OrderItemInput> }                      // DTO / 嵌套结构
enum Priority { LOW, HIGH }
interface OrderApi { GET '/api/orders/{id}' -> getOrderDetail }        // GET/POST/PUT/DELETE -> 绑定 logic 名
@service(kind = 'dubbo', group = 'x', version = '1.0') service UserSvc { getUser(id: Integer): User; }
@service(kind = 'http', baseUrl = 'http://x') service ErpApi { GET '/path' -> opName(id: Integer): Order; }
component RichTable { pkg: 'npm-pkg-name'; defaultProps: { data: Json }; events: ['onClick'] }
page OrderList { <table dataSource={useQuery('listOrders')}> <column field="id" /> </table> }
//   页面绑定: useQuery('logic') / useMutation('logic', args...) / navigate('PageName', row.id) / openDialog('DialogName')
//   内置组件: table/column/button/form/input/repeat/text/detail；管理端常用: tag(color)/statistic(title,value)
//     tabs > pane(title) / checkbox / switch / radio(options="A,B") / avatar / badge(count) / card(title)——枚举列自动彩色标签、Boolean 字段自动开关
//   新增/编辑类表单用 dialog 声明（不进路由），列表页用 openDialog('DialogName') 打开；三方组件用 component 注册名

// ---- 逻辑（TS 风格 + 两处有意偏离，勿写成 TS！）----
@export
logic createOrder(input: OrderInput): Order {
  if (input.items.count === 0) { return null; }
  order := new Order();          // 偏离①：:= 声明（没有 let/const/var！）
  order.total = 0;
  order.save();                  // 实例方法 save()/delete()；写操作自动事务
  for (it in input.items) {      // 偏离②：in 遍历元素（语义同 for-of，不是 TS for-in 键遍历）
    it.save();
  }
  return order;
}

// ---- 实体查询（领域 DSL）----
Order.all                                  // 全表
Order.get(id)                              // 主键查
Order.where(total > 0)                     // 条件运算符: = >= <= > < like in（= 是"等于"，非赋值！）
Order.where(a like '%x%', b >= 1)          // 逗号分隔 = AND；条件内可用 && / ||
Order.where(...).orderBy(field desc).limit(10)    // 链式：orderBy 方向 asc|desc
Order.where(...).page(n, size)             // 分页 → Page<T>
Order.aggregate(sum(field))                // 聚合: sum/avg/max/min/count；可 .groupBy(field)

// ---- 类型（非 TS 类型名！）----
Integer Decimal String Boolean Date Time DateTime   // 内置（没有 number/string/Date）
List<T> Map<T> Page<T>                              // 泛型；实体/结构/枚举短名；跨源同名用 dsName.Entity

// ---- 禁止事项 ----
// 无 let/const/var（用 :=）；无函数定义/箭头函数；无三元 ?:；无模板字符串；
// 无 ==（用 ===）；无 Decimal(10,2) 以外的类型参数化；接口体不是 TS interface 语法`;
