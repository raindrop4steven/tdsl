# 12 系统设计：P1 切面二 —— CRUD 能跑的 Todo（编译器能力扩展）

> 关联：`docs/20_系统设计/系统设计.md` §5（codegen）、`docs/30_详细设计/详细设计.md` §4（接口/页面）
> 状态：**阶段二（系统设计）** — 待用户 Gate 确认
> 定位：让 `.tdsl` 描述一个**可增删改查（CRUD）的 Todo**，编译器自动生成**能真正跑起来**的 Java + React。
> 区别于 P0：P0 只生成"能编译"的工程（React 端是 MOCK 假数据）；本切面让**前端真实调后端、浏览器可操作**。

---

## 1. 目标与验收

### 1.1 达成什么

用户写一段 TDSL（含实体、逻辑、接口），编译器生成**一整个能跑的 Spring Boot + React 工程**：
- **Java 端**：起在 8080，REST 接口真实操作 H2 数据库。
- **React 端**：起在 5173，真实 fetch 后端，浏览器里能**新增 / 查看 / 修改 / 删除** Todo。
- 前后端同时启动，浏览器能看到并操作真实的 Todo 数据。

### 1.2 验收标准（可观察）

- [ ] `todo.tdsl` 用命令式 logic + interface 描述 CRUD，`npm run slice` 全链路通过（parse/typecheck/codegen/build）。
- [ ] `mvn spring-boot:run` 起 Java，`curl` 可 GET/POST/PUT/DELETE `/api/todos`。
- [ ] `npm run dev` 起 React，浏览器可增删改查，操作真实落库（重启不丢，H2 内存库重启会重置——验收以"页面操作即时生效"为准）。
- [ ] 单测覆盖：parser 的 interface 语法、typecheck 的实体方法签名、codegen 的 Controller/React CRUD 快照。
- [ ] 不回归 P0 已有闭环。

---

## 2. TDSL 书写面（新增语法）

```ts
// ---- 实体（已有）----
@datasource('defaultDS')
entity Todo {
  id: Integer @pk;
  title: String;
  done: Boolean;
}

// ---- 结构（已有）----
struct TodoInput { title: String; done: Boolean; }

// ---- 逻辑（命令式，新增实体方法调用）----
@export
logic findTodos(): List<Todo> {
  return Todo.all;
}

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

// ---- 接口（新增）----
interface TodoApi {
  GET    /api/todos       -> findTodos
  POST   /api/todos       -> createTodo
  PUT    /api/todos/{id}  -> updateTodo
  DELETE /api/todos/{id}  -> deleteTodo
}
```

### 2.1 新增语法元素

| 语法 | 归一为 IR |
|------|----------|
| `interface TodoApi { ... }` | `InterfaceNode` |
| `GET /path -> logicName` | `EndpointNode { method, path, logicRef }` |
| `Todo.all` | `Call`/`Member` → 静态查询（已有，`findTodos` 直接 `return Todo.all`） |
| `Todo.get(id)` | 实体静态方法：按主键查 |
| `entity.save()` | 实体方法：插入/更新 |
| `entity.delete()` | 实体方法：删除 |
| `id: Integer`（Logic 参数） | `ParamNode`（IR 已有，打通到 codegen） |

---

## 3. IR 变更（core）

### 3.1 新增节点

```ts
// types.ts 新增
interface InterfaceNode extends BaseNode {
  kind: 'Interface';
  name: string;
  endpoints: EndpointNode[];
}

interface EndpointNode extends BaseNode {
  kind: 'Endpoint';
  name: string;              // 方法名（可由 logicRef 派生）
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;              // 如 /api/todos、/api/todos/{id}
  logicRef?: string;         // 绑定的 Logic nodePath
}
```

- `AppNode` 新增 `interfaces: InterfaceNode[]`。
- `AnyNode` 判别联合新增 `InterfaceNode | EndpointNode`。

### 3.2 实体方法（小语言语义约定）

在 typecheck/codegen 里对特定 `Call` 形态识别实体方法（**不改 Expr 结构**，靠语义识别）：

| 表达式形态 | 语义 | 类型 |
|-----------|------|------|
| `Todo.all`（`Member(Ident('Todo'), 'all')`） | 查全部 | `List<Todo>` |
| `Todo.get(id)`（`Call(Member(Ident('Todo'),'get'), [id])`） | 按主键查 | `Todo` |
| `entity.save()`（`Call(Member(entity,'save'), [])`） | 插入/更新 | `void` |
| `entity.delete()`（`Call(Member(entity,'delete'), [])`） | 删除 | `void` |

> 说明：这些在 AST 里都是普通的 `Call(Member(...))`。语义含义由 typecheck/codegen 按"接收者类型 + 方法名"识别，**不新增 Expr 节点**，保持小语言最小化。

---

## 4. parser 变更

新增 `parseInterface()`：

```
interface Name {
  METHOD path -> logicName
  ...
}
```

- 顶层 `interface` 关键字分支。
- 每个 Endpoint：`method`（GET/POST/PUT/DELETE 关键字）+ `path`（字符串）+ `->` + `logicName`。
- link 阶段：`logicRef` 绑定为 Logic 的 nodePath（悬空则抛 SyntaxError）。
- Logic 参数已在 parseLogic 支持（`parseLogic` 已解析 params），保留。

---

## 5. typecheck 变更

新增两条检查（在现有 `check()` 基础上）：

1. **实体方法签名校验**：识别 `Todo.get`/`.save`/`.delete`，校验：
   - `Todo.get(id)`：id 必须可赋给实体主键类型（Integer）。
   - `entity.save()`/`entity.delete()`：接收者必须是实体类型（`infer` 出实体）。
   - 未知实体方法 → 诊断"实体 X 无方法 Y"。
2. **Interface.logicRef 悬空**：遍历每个 Endpoint，`resolve(app, logicRef)` 失败 → 诊断。

同时保留现有：悬空引用、ForEach `.all`。

> 注：完整类型推导（infer/assignable/隐式转换）在 `11_系统设计-P1-typecheck.md` 切面。
> 本切面 typecheck 只补"实体方法 + Interface"，依赖简单的接收者类型识别即可。

---

## 6. codegen-java 变更

### 6.1 Service 生成带参（关键改造）

当前 `serviceFile` 生成 `public returnType name()` **无参**。改为：

- 遍历 `logic.params`，生成带参方法签名：`public returnType name(ParamType p1, ...)`。
- 方法体用 params 名字。

### 6.2 实体方法 → Java（在 genExpr/genStatement 增加映射）

| TDSL | Java 生成 |
|------|----------|
| `Todo.all` | `todoRepository.findAll()` |
| `Todo.get(id)` | `todoRepository.findById(id).orElseThrow()` |
| `entity.save()`（语句） | `todoRepository.save(entity);` |
| `entity.delete()`（语句） | `todoRepository.delete(entity);` |

- `Todo.get` / `.all` 需要该实体 Repository 注入——沿用 `collectUsedEntities` 收集并注入。
- `entity.save()` 接收者若是实体变量，需注入该实体 Repository。

### 6.3 Controller 生成（新增）

每个 `InterfaceNode` 生成一个 `@RestController`：

```java
@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class TodoApiController {
  private final FindTodosService findTodosService;
  private final CreateTodoService createTodoService;
  // ... 每个 logic 一个 service

  @GetMapping("/todos")
  public List<Todo> findTodos() { return findTodosService.findTodos(); }

  @PostMapping("/todos")
  public Todo createTodo(@RequestBody TodoInput input) { return createTodoService.createTodo(input); }

  @PutMapping("/todos/{id}")
  public Todo updateTodo(@PathVariable Long id, @RequestBody TodoInput input) {
    return updateTodoService.updateTodo(id, input);
  }

  @DeleteMapping("/todos/{id}")
  public Boolean deleteTodo(@PathVariable Long id) { return deleteTodoService.deleteTodo(id); }
}
```

- 路径 `{id}` 变量与 logic 参数名对应（约定：path 变量名 == 参数名）。
- `@RequestBody` 用于结构/实体类型的参数；`@PathVariable` 用于 path 变量。
- 返回类型 = logic 返回类型。
- `@CrossOrigin` 解决 5173 → 8080 跨域。

---

## 7. codegen-react 变更

把固定 MOCK 模板改为**真实 CRUD** 单页应用（单个 `App.tsx`）：

```
GET    /api/todos      → 列表（useEffect 加载）
POST   /api/todos      → 新增（表单 → POST → 刷新列表）
PUT    /api/todos/{id} → 修改（点击编辑 → 弹框/内联 → PUT）
DELETE /api/todos/{id} → 删除（点击删除 → DELETE → 刷新）
```

- `API = 'http://localhost:8080'`（简单起见直接绝对地址，配 @CrossOrigin）。
- 组件：输入框（title）+ 勾选（done）+ 删除按钮。
- 类型：`Todo` / `TodoInput` 从 IR 生成（`types/todo.ts` 已有 Todo，补 TodoInput）。
- 保留 `package.json`/`vite.config`/`tsconfig` 脚手架（vite build 已通）。

> 说明：真正"从 ViewNode 声明式生成页面"属 P1 后续（页面 View 元素切面）。本切面先用**固定 CRUD 模板**，
> 由 Interface 驱动生成真实的四操作前端，达成"能跑"目标。页面声明式化在后续切面演进。

---

## 8. 切面边界

| 项 | 本切面 | 说明 |
|----|--------|------|
| Interface/Endpoint IR + 语法 + Controller | ✅ | 核心交付 |
| 命令式 logic（带参 + 实体方法） | ✅ | create/update/delete/find |
| React 真实 CRUD fetch | ✅ | 固定模板，Interface 驱动 |
| 实体方法 get/save/delete/all | ✅ | 语义识别，不改 Expr |
| 完整类型推导/隐式转换/泛型统一 | ❌ | 前一切面（11_系统设计-P1-typecheck） |
| 页面 View 声明式（ViewNode/JSX） | ❌ | P1 后续切面 |
| JSON AST 序列化 / zod | ❌ | 范围决策：不做，保留扩展能力 |
| 表达式运算符扩展（- * / 等） | ❌ | P1 后续切面（core/parser/typecheck/codegen 联动） |
| 种子数据 | ✅ | 用 `data.sql` 或 `CommandLineRunner` 生成（方案内，非手改产物——属 codegen 脚手架一部分） |

---

## 9. 测试策略

- **parser**：interface 语法正/负用例；`->` 绑定 logicRef。
- **typecheck**：实体方法签名（get/save/delete 接收者类型）、Interface logicRef 悬空。
- **codegen-java**：快照——带参 Service、Controller 内容、实体方法映射。
- **codegen-react**：快照——CRUD App.tsx。
- **集成（slice.ts）**：扩展 `todo.tdsl` 为 CRUD，`npm run slice` 全链路 + 双端 build。
- **运行验证**（手动/脚本）：mvn spring-boot:run + npm run dev，curl 验证四操作。

---

## 10. 里程碑（本切面内）

1. **M1 IR+parser**：Interface/Endpoint 节点 + 语法 + link；`npm test` parser。
2. **M2 typecheck**：实体方法签名 + Interface 悬空检查。
3. **M3 codegen-java**：带参 Service + 实体方法映射 + Controller；mvn compile 通过。
4. **M4 codegen-react**：真实 CRUD fetch + UI；vite build 通过。
5. **M5 运行验收**：双起 + curl 四操作 + 浏览器操作。

---

## QA 记录（本切面）

| 序号 | 问题描述 | 结论 | 状态 |
|------|---------|------|------|
| 1 | `findTodos` 直接 `return Todo.all` 够不够？ | 够——`Todo.all` 语义即"查全部"，codegen 映射 `findAll()`。P0 里 findTodos 用 for+if 过滤，本切面允许简写 | 已决策 |
| 2 | Controller path 变量 `{id}` 怎么绑定参数？ | 约定：path 变量名 == logic 参数名（`{id}` ↔ `id`），`@PathVariable` 注入 | 已决策 |
| 3 | `@RequestBody` 用在哪些参数？ | 结构/实体类型参数（如 `input: TodoInput`）；primitive（id）用 `@PathVariable` | 已决策 |
| 4 | 种子数据怎么进？ | codegen 生成 `data.sql` 或 `CommandLineRunner`，作为脚手架一部分（不是手改产物） | 已决策 |
| 5 | React 页面声明式化？ | 本切面用固定 CRUD 模板 + Interface 驱动，页面 ViewNode 化在后续切面 | 已决策 |
| 6 | 实体方法不改 Expr 结构？ | 对——`get/save/delete/all` 都是普通 Call/Member，语义在 typecheck/codegen 识别，保持 AST 最小 | 已决策 |
