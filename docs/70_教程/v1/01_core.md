# 01 core：语义核 / Typed AST

> 配套代码：`packages/core/src/`
> 定位：全项目的**唯一事实来源（SSoT）**。只定义"树长什么样"，不含业务逻辑。

## 1. 文件分组

```
src/types.ts       # 树的主干节点类型（App/DataSource/Entity/...）
src/typeref.ts     # 类型引用 TypeRef
src/expr.ts        # 小语言表达式
src/statement.ts   # 小语言语句
src/id.ts          # createId / createNode（uuid 生成）
src/path.ts        # nodePath 寻址：collectPaths / nodePathOf / resolve
src/index.ts       # 出口
```

前四个文件**只有类型没有逻辑**。

## 2. 树的主干（types.ts）

```ts
interface BaseNode {
  kind: string;      // 判别标签（字面量）
  id: string;        // 全局唯一 uuid
}

interface AppNode extends BaseNode {
  kind: 'App';
  name: string;
  datasources: DataSourceNode[];   // 数据源（含实体）
  structures: StructureNode[];     // 结构（DTO）
  enums: EnumNode[];
  logics: LogicNode[];             // 业务逻辑（含小语言）
}
```

`AppNode` 是树根，逐层嵌套：`DataSource → Entity → Property`。每个具体节点 `kind` 是**字符串字面量类型**（`'App'`/`'Entity'`…），这就是判别联合的判别符。

### 关于 kind 用字面量而非 enum

这是判别联合的标准做法，不是偷懒：

1. **收窄机制依赖字面量** —— `switch (node.kind)` 自动收窄，靠 kind 是字面量类型。若 `kind: NodeKind`（整个枚举）则判别式失效，收窄全废。
2. **行业先例** —— Babel / Prettier / swc / ESLint 的 AST 节点 type/kind 全是字符串字面量联合；**Token 类型**（封闭且频繁比较的集合）才用枚举/集中定义（见 `parser/src/lexer.ts` 顶部的 `TokenType`）。
3. **集中定义已由类型推导保证** —— `export type NodeKind = AnyNode['kind']` 从节点类型自动推导，新增节点自动纳入，无需手维护枚举表（手维护反而有"改了类型忘了改表"的漂移风险）。

## 3. 类型引用（typeref.ts）

```ts
type TypeRef =
  | { kind: 'primitive'; builtin: 'Boolean'|'Integer'|'Decimal'|'String'|'Date'|'Time'|'DateTime' }
  | { kind: 'reference'; path: string }        // ← 指向某节点的 nodePath
  | { kind: 'generic'; name: 'List'|'Map'|'Page'; args: TypeRef[] }
  | { kind: 'db'; builtin: string; args?: ... };
```

注意 `reference` 用 `path: string` 而非对象指针 —— **符号引用**（设计决策 D3）。`List<Todo>` 的 AST 形态：

```ts
{ kind: 'generic', name: 'List',
  args: [{ kind: 'reference', path: 'app.datasources.defaultDS.entities.Todo' }] }
```

## 4. 小语言（expr.ts / statement.ts）

逻辑体里的代码在 AST 里是嵌套的语句/表达式对象树：

```ts
type Expr =
  | { kind: 'Ident'; name: string }                          // todo
  | { kind: 'Member'; obj: Expr; prop: string }              // todo.done
  | { kind: 'Call'; callee: Expr; args: Expr[] }             // result.add(todo)
  | { kind: 'NewList'; elem: TypeRef; items: Expr[] }        // new List<Todo>()
  | { kind: 'Binary'; operator: '==='|'!=='|...; left; right }  // todo.done === false
  | ...字面量/分组

type Statement =
  | { kind: 'VarDecl'; name: string; init?: Expr }           // result := new List<Todo>()
  | { kind: 'Return'; value?: Expr }
  | { kind: 'If'; cond: Expr; then: Statement[]; else?: Statement[] }
  | { kind: 'ForEach'; item: string; container: Expr; body: Statement[] }
  | { kind: 'CallStmt'; call: Expr }
  | { kind: 'Assign'; target: Expr; value: Expr }
```

`if (todo.done === false) { result.add(todo); }` 会被 parse 成嵌套对象树。之后 typecheck 检查它、生成器翻译它，都只认这棵树，不认识 TDSL 文本。

## 5. 工具函数（id.ts / path.ts）

### id.ts

```ts
function createId(): string { return randomUUID(); }                       // uuid
function createNode(kind): { kind; id }                                    // 骨架节点，供构造方 spread 扩展
```

### path.ts —— 树寻址（本包最值得看）

```ts
function collectPaths(app): PathEntry[] {
  // 遍历整棵树，给每个节点算出一条 nodePath
  //   app.datasources.defaultDS.entities.Todo
  //   app.datasources.defaultDS.entities.Todo.properties.title
  //   app.logics.findTodos.returns[0]
}

function nodePathOf(app, node): string | null    // 节点 → 路径（反查）
function resolve(app, path): T | null             // 路径 → 节点（找不到返回 null）
```

`collectPaths` 是纯遍历：从 `app` 出发逐层拼字符串路径，把每个节点和它的路径配对收集。`resolve` 线性查找（树小够用，以后可换 Map）。**悬空引用 = 查不到 = 返回 null**。

## 6. 本包要记住的 3 件事

1. **树形数据模型**：`App → DataSource → Entity → Property`，加上 logic/expr/statement，全是指向嵌套的类型化对象。
2. **判别联合**：每个节点有 `kind` 字面量，是后续所有 switch/收窄的基础。
3. **引用是字符串路径**：`TypeRef.path` 不是对象指针，统一走 nodePath + `resolve`。