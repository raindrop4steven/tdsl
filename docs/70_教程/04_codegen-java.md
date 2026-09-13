# 04 codegen-java：同一棵 AST → Spring Boot

> 配套代码：`packages/codegen-java/src/index.ts`（1909 行）+ `type-map.ts`（47 行，`never` 穷尽示范）
> 定位：`generateJava(app, { libs })` → `GeneratedFile[]`。纯函数不碰磁盘，同 AST 必得同输出。

## 1. 产出文件全景

| 生成物 | 来源节点 | 关键机制 |
|--------|----------|----------|
| `pom.xml` | **dependency 声明**（dev/32） | 声明驱动注入；版本缺省取 libs 产物坐标 |
| `<App>Application.java` / `application.yml` | 脚手架 | H2 + web + data-jpa + openfeign |
| `entity/Order.java` | Entity | `@Entity/@Table/@Id/@Column`；SQL 保留字表名加引号 |
| `enums/Xxx.java` | Enum | 恒带 `label` 字段（无标签退化为枚举名） |
| `repository/OrderRepository.java` | 实体查询 | ★**QuerySpec 机制**（§2） |
| `structure/Xxx.java` | Structure | POJO + getter/setter；引用实体自动补 import |
| `service/XxxService.java` | Logic | 每逻辑一个方法；`.save()/.delete()` 自动 `@Transactional` |
| `controller/XxxApiController.java` | Interface | `@RestController`；路径参数 `{id}` → `@PathVariable` |
| `service/api/UserService.java` | Service | dubbo/bean → 普通接口；http → `@FeignClient(name, url)` |
| `tdsl/TdslError*.java` | 脚手架 | 统一异常响应体（A1 配套） |

## 2. QuerySpec 机制（M2 的核心）

扫描所有 logic 的实体查询表达式 → 每个实体归集"查询形态"（条件集 + 排序 + 分页/聚合/分组）→ 去重（`sameSpec`）→ 每个 QuerySpec 生成一个 Repository 方法：

- 派生方法名：`findByCustomerLikeAndTotalGreaterThanOrderByTotalDesc`（`opSuffix` 映射运算符后缀）
- `limit(n)` → `findTop{n}By...`
- `.page(n,size)` → `Pageable` 参数 + 返回 `Page<T>`
- 聚合 → `@Query("select sum(o.total) from Order o ...")` JPQL；`.groupBy` → `List<Map<String,Object>>`

**为什么不用固定模板**：logic 方法体是**逐语句翻译**（`genStatement`/`genExpr`）——TDSL 能表达什么，Java 就能生成什么，这是"非固定模板生成"的底气。

## 3. 表达式翻译要点

| TDSL | Java |
|------|------|
| `===` / `!==` | `equals` / `!equals`（String/对象） |
| Decimal 算术 | 自动 `BigDecimal.valueOf(...)` 包装、`compareTo` 比较 |
| `null` / 布尔 / 字符串 | 直译 |
| `throw 'msg'` | `throw new TdslError(msg)`（dev/30：框架错误类 + 全局 advice 映射 HTTP 4xx） |

## 4. FFI 与依赖（dev/27 + dev/32）

- **import 收集**：`collectFfiClassesInExpr` 扫 logic 表达式树 → 内核五域 + 依赖产物类（含 `ns.Alias` 限定形态）→ 显式 `import 全限定名;`
- **pom 注入改声明驱动**：`dependency java "g:a:v"` 全量进 `<dependencies>`（service 的 dubbo/bean/http 依赖另有注入通道）；**不再从目录反推**——目录是能力清单，声明才是意图
- 产物类成员按 `FfiMethod.java` 模板翻译（缺省 `{recv}.{name}({args})` 直发）

## 5. 本包要记住的 3 件事

1. **pom 是声明的产物**：改 pom 内容先改 TDSL 的 dependency 声明（或 libs 产物坐标），不是改生成器模板。
2. **QuerySpec 是"查询语言 → 派生方法"的编译层**：新增查询形态 = parser 分派 → typecheck 白名单 → QuerySpec 派生名，三处同步。
3. **纯函数纪律**：生成器里没有 `writeFileSync`；写盘只发生在 slice/CLI 的 IO 层。

**动手练习**：在 todo.tdsl 加一条 `Order.where(total > 0).page(1, 5)` 查询，跑 `npm run slice` 后到 `generated/java` 里找对应的 Repository 派生方法与 Service 调用。
