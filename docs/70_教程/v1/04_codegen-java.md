# 04 codegen-java：后端生成

> 配套代码：`packages/codegen-java/src/`（`type-map.ts` + `index.ts`）
> 定位：AST → **一整个可编译的 Spring Boot 工程**（pom.xml + 实体 + Repository + Service + 配置），不是零散代码片段。

## 1. 核心抽象：GeneratedFile

```ts
interface GeneratedFile { path: string; content: string; }
```

生成器**不写磁盘** —— 纯函数式返回"文件列表"（路径 + 内容），由调用方（slice.ts）写盘。带来两个性质：

1. **确定性**：同 AST 必得同文件列表 → 可快照测试、可 diff 回归。
2. **可组合**：返回列表可合并、筛选、检查，调用方掌握控制权。

## 2. 文件结构

```
src/type-map.ts   # TypeRef → Java 类型 的翻译表（纯函数）
src/index.ts      # generateJava 主入口 + 各文件生成函数
```

## 3. ① type-map.ts —— 类型翻译表

```ts
function javaType(tr: TypeRef): string {
  switch (tr.kind) {
    case 'primitive':
      switch (tr.builtin) {
        case 'Integer':  return 'Long';
        case 'Decimal':  return 'java.math.BigDecimal';
        case 'Date':     return 'java.time.LocalDate';
        ...
      }
    case 'reference': return typeNameFromPath(tr.path);  // 'app...entities.Todo' → 'Todo'
    case 'generic':   return `java.util.List<${javaType(tr.args[0])}>`;
    case 'db':        return 'java.math.BigDecimal';
  }
}
```

关键设计：

- **返回全限定类型**（`java.util.List`、`java.math.BigDecimal`）→ 生成文件**不需要 import 管理**，确定性更强，代价是代码啰嗦但正确性优先。
- 底层用 `switch` 而非 if —— `never` 穷尽，P1 给 `TypeRef` 加种类时编译直接报错。
- **`Integer → Long` 是语义映射不是机械映射**：TDSL 的 `Integer` 语义是"长整型"（NASL 调研表：`Integer` ↔ Java `long`）。

## 4. ② generateJava 主入口 —— 组装工程

```ts
function generateJava(app): GeneratedFile[] {
  const entities = app.datasources.flatMap(ds => ds.entities);
  files.push(...scaffoldFiles(app));        // pom.xml + Application + application.yml
  for (const ent of entities) {
    files.push(entityFile(pkg, ent));       // JPA 实体
    files.push(repositoryFile(pkg, ent));   // Repository 接口（每实体一个文件）
  }
  for (const logic of app.logics) {
    files.push(serviceFile(app, logic));    // Service（含逻辑体翻译）
  }
}
```

**产物是"工程"不是"文件"**：pom.xml（Spring Boot 2.7 + JPA + H2）保证生成物能独立 `mvn compile`。

## 5. ③ Entity → JPA（entityFile）

```ts
// AST: { name:'Todo', properties:[{name:'id', primary:true, type:Integer}, ...] }
→
@Entity
@Table(name = "todo")
public class Todo {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(nullable = false)
  private String title;
  ...
}
```

**`@Column(nullable = false)` 的由来**：AST 里 `nullable` 未设置（undefined）→ `p.nullable !== true` 为 true → 非空。这是**语义默认值**：TDSL 不写 `@nullable` 就是非空。`@pk` → `@Id + @GeneratedValue`。纯数据驱动。

## 6. ④ Logic → Service（serviceFile + 小语言翻译）

把 AST 的小语言（Statement/Expr 树）翻译成 Java 方法体：

```ts
// AST:
// ForEach { item:'todo', container:Member(Ident('Todo'), 'all'),
//           body:[ If { cond: Binary(===, Member(Ident('todo'),'done'), Bool(false)),
//                      then:[CallStmt(Call(Member(Ident('result'),'add'),[Ident('todo')]))] } ] }
→
for (Todo todo : todoRepository.findAll()) {
  if ((todo.getDone() == false)) {
    result.add(todo);
  }
}
```

翻译规则（genStatement / genExpr）：

| AST | Java | 说明 |
|-----|------|------|
| `ForEach(x in Todo.all)` | `for (Todo x : todoRepository.findAll())` | `X.all` → 实体静态引用 → repo 方法 |
| `todo.done`（实体字段） | `todo.getDone()` | 字段访问 → getter |
| `todo.done === false` | `(todo.getDone() == false)` | `===` → `==`（平台翻译层） |
| `result.add(todo)` | `result.add(todo)` | 方法调用 1:1 |
| `new List<Todo>()` | `new java.util.ArrayList<Todo>()` | 泛型/集合映射 |

### 关键机制 1：vars 上下文（生成器自带微型类型推导）

`todo.getDone()` 不是魔法 —— 生成器**跟踪变量类型**：

```ts
// genStatement 内部共享一个 vars: Map<变量名, 实体类名>
case 'ForEach':
  vars.set(st.item, ent.name);   // todo → 'Todo'
case 'Member':  // 字段访问
  if (vars.get(e.obj.name) 是实体 && 实体有这个字段)
    return `${e.obj.name}.get${cap(e.prop)}()`;   // → todo.getDone()
```

`ForEach` 先把 `todo` 绑定为 `Todo`，之后 `todo.done` 知道该走 getter。**注意嵌套块共享同一 vars**（If/ForEach 的 body 不新建 Map，否则外层作用域丢失）。

### 关键机制 2：实体静态引用 X.all + 按需注入

`Todo.all` 是 TDSL 静态集合引用语法糖，识别为 `Member(Ident('Todo'), 'all')` + `Todo` 是实体 → 翻译成 `todoRepository.findAll()`。Repository 注入也是数据驱动：

```ts
// 扫描逻辑体所有 ForEach，收集用到的实体
const usedEntities = collectUsedEntities(app, logic);
// → private final TodoRepository todoRepository;
// → 构造器注入，只注用到的 repo
```

### 关键机制 3：never 穷尽兜底

```ts
switch (st.kind) {
  ...
  default: { const _never: never = st; return [_never]; }  // 编译期强制
}
```

加新语句类型没处理 → TS 编译报错。**"新增节点必须同步更新生成器"约定的落地。**

## 7. 测试（5 个用例）

1. 脚手架文件存在（pom/Application/yml）
2. Entity 内容断言（@Entity、Long id、getter/setter）
3. Repository 断言（extends JpaRepository<Todo, Long>）
4. **逻辑体翻译断言**（`todoRepository.findAll()`、`todo.getDone() == false`、`result.add(todo)`、`return result;`）—— 验证小语言翻译正确
5. **确定性**：同输入两次生成，逐字节相等

## 8. 本包要记住的 3 件事

1. **生成器 = 纯函数**：AST → `GeneratedFile[]`，确定性、可测试、不碰磁盘。
2. **平台差异靠翻译层**：`===`→`==`、`Integer`→`Long`、字段→getter、`X.all`→repo —— AST 语义不变，目标语言适配。
3. **生成器自带微型类型推导**（vars 上下文）+ `never` 穷尽 —— 不是字符串拼接，是有状态的、受类型约束的翻译。