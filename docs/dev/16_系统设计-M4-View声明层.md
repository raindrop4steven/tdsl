# 16 系统设计：M4 —— 页面 View 声明层 + 路由（前端真生成）

> 关联：`docs/dev/14_路线规划-NASL对标与前后端能力.md` §5（前端路线）、`10_设计/设计总览.md` §4（接口/页面）、`docs/dev/15`（M1 作用域）
> 状态：**阶段二（系统设计）** — 待用户 Gate 确认
> 定位：把 codegen-react 从"固定模板 + 数据填充"升级为**声明式前端生成**——TDSL 用 `page` 声明页面结构，
> 生成器按声明构建 React 组件 + 路由 + 数据绑定。这是"前端真生成"的关键切面。

---

## 1. 目标与验收

### 1.1 现状问题

codegen-react 的 `appFile` 生成一个固定模板的单页应用（列表 + 表单 + 明细行），
字段名从 AST 提取但**页面布局、交互、数据流全部写死**。无法表达：
- 多页面应用（列表页/详情页/表单页）
- 页面间导航
- 声明式数据绑定（哪个页面用哪个 logic/query）

### 1.2 达成什么

1. **`page` 声明语法**：TDSL 描述页面结构（JSX 子集），parser 解析为 `ViewNode` IR。
2. **ViewElement 组件映射**：`table/column/button/form/input/repeat/select/date...` → React 组件。
3. **数据绑定**：`dataSource={useQuery('logic')}` / `submit={useMutation('logic')}` → 生成 axios/fetch + hooks。
4. **多页面路由**：多个 `page` → React Router 路由表 + 页面间导航。
5. 替换现有固定模板 `appFile`。

### 1.3 验收标准

- [ ] `parse` 通过：`page` + JSX 子集（table/column/button/form/input/repeat）。
- [ ] codegen-react 按 ViewNode 生成多页面 React 应用（不再是固定模板）。
- [ ] 路由：多个 `page` → 路由表 + 导航链接。
- [ ] 数据绑定：`useQuery('listOrders')` → 生成的组件真实 fetch。
- [ ] 双端 build 通过；浏览器能访问列表页/详情页/表单页并操作。
- [ ] 不回归现有单页 CRUD 能力（order demo 可改造成 page 声明式）。

---

## 2. TDSL 书写面（page 声明）

```ts
// ---- 列表页 ----
page OrderList {
  <table dataSource={useQuery('listOrders')}>
    <column field="id" />
    <column field="customer" />
    <column field="total" />
    <button action={navigate('OrderDetail', { id: row.id })}>详情</button>
    <button action={useMutation('deleteOrder', row.id)}>删除</button>
  </table>
  <button action={navigate('OrderCreate')}>新增订单</button>
}

// ---- 表单页（创建订单，含明细 repeat） ----
page OrderCreate {
  <form submit={useMutation('createOrder')}>
    <input field="customer" />
    <repeat field="items">
      <input field="product" /><input field="price" /><input field="qty" />
    </repeat>
    <button type="submit">提交</button>
  </form>
}

// ---- 详情页 ----
page OrderDetail {
  <detail dataSource={useQuery('getOrderDetail', { id: $route.id })}>
    <text field="order.customer" />
    <table dataSource={$data.items}>
      <column field="product" />
      <column field="price" />
      <column field="qty" />
    </table>
  </detail>
}
```

### 2.1 语法元素

| 元素 | 语义 | IR |
|------|------|-----|
| `page Name { ... }` | 页面声明 | `ViewNode { kind:'page', elements }` |
| `<table dataSource={...}>` | 表格 | `ViewElementNode { type:'table', props, bindings }` |
| `<column field="x" />` | 列 | `ViewElementNode { type:'column', props:{field} }` |
| `<button action={...}>` | 按钮 | `ViewElementNode { type:'button', props:{action} }` |
| `<form submit={...}>` | 表单 | `ViewElementNode { type:'form', props:{submit} }` |
| `<input field="x" />` | 输入 | `ViewElementNode { type:'input', props:{field} }` |
| `<repeat field="items">` | 重复块（明细行） | `ViewElementNode { type:'repeat', props:{field} }` |
| `useQuery('logic', args)` | 查询绑定 | `BindingNode { name:'useQuery', target:'app.logics.x' }` |
| `useMutation('logic', args)` | 变更绑定 | `BindingNode { name:'useMutation', target:'app.logics.x' }` |
| `navigate('Page', args)` | 导航 | `BindingNode { name:'navigate', target:'Page' }` |
| `$route.x` / `$data.x` / `row.x` | 路由参数/查询结果/行上下文 | 表达式占位 |

### 2.2 设计取舍

- **JSX 子集**（对齐 TS 书写面本能）：`<tag attr={expr}>` 自闭合或成对，不支持嵌套复杂 JSX 表达式。
- **组件集合从简**：table/column/form/input/button/repeat/text/detail——够 CRUD 场景，
  复杂组件靠 M6 的 `component` 注册扩展。
- **数据流约定**：`dataSource`（查询）读、`action`/`submit`（变更）写，页面通过 `$data`/`row`/`$route` 引用。

---

## 3. IR 变更（core）

复用详细设计 §4 已定义的 `ViewNode`/`ViewElementNode`/`BindingNode`（补全字段）：

```ts
interface ViewNode extends BaseNode {
  kind: 'View';
  name: string;
  viewKind: 'page' | 'dialog' | 'block';   // 本切面先 page
  elements: ViewElementNode[];
}

interface ViewElementNode extends BaseNode {
  kind: 'ViewElement';
  type: string;                            // 'table'|'column'|'button'|'form'|'input'|'repeat'|'text'|'detail'
  props: Record<string, Expr | string>;    // field/value/action/submit/dataSource 等
  children: ViewElementNode[];             // 嵌套元素（table>column、form>input、repeat>...）
}

interface BindingNode extends BaseNode {
  kind: 'Binding';
  name: string;                            // 'useQuery'|'useMutation'|'navigate'
  target: string;                          // logic 短名 / 页面名
  args?: Expr[];
}
```

- `AppNode.views: ViewNode[]` 新增。
- `AnyNode` 判别联合新增 `ViewNode | ViewElementNode | BindingNode`。
- 所有生成器/编译器 `never` 穷尽强制处理。

### 3.1 ViewElement 与 Binding 的关系

- `props` 里的 `dataSource={useQuery(...)}` / `action={...}` / `submit={...}`：
  parser 把 `useQuery('logic')` 形态提取为 `BindingNode`，放进元素的 `bindings`（`props` 保留表达式引用）。
- `row.x` / `$data.x` / `$route.x`：保留为表达式（Ident/Member），codegen-react 按上下文映射。

---

## 4. parser 变更

新增 `parsePage()`，顶层 `page` 关键字分支：

```
page Ident { <Element ...> ... }
Element := '<' Tag (attr '=' value)* ('/>' | '>' children* '</' Tag '>')
attr value := 'ident' | 'string' | '{' Expr '}'        // 表达式用现有 parseExpr
```

- `Tag`：`table/column/button/form/input/repeat/text/detail`。
- 嵌套：`table > column`、`form > input`、`repeat > input`。
- `useQuery('x')`/`useMutation('x')`/`navigate('P')` 在 `{...}` 里解析为 Call，link 阶段绑定
  `BindingNode.target` → logic nodePath（`useQuery`/`useMutation`）或页面名（`navigate`）。
- `field="x"` 字符串 attr → `props.field`。
- link 阶段：binding 的 logic 短名 → nodePath（悬空报错）。

---

## 5. typecheck 变更

- ViewElement 校验：`type` 必须是已知组件类型（table/column/button/...）。
- Binding 校验：
  - `useQuery`/`useMutation` → logic 存在（resolve 成功）。
  - `navigate` → 目标页面存在（`app.views.<name>`）。
- `field` 属性 → 对应实体/结构字段存在（需从 dataSource 的返回类型推导，M4 先做宽松校验）。

---

## 6. codegen-react 变更（核心）

### 6.1 生成结构

```
src/
  main.tsx                    # ReactDOM + BrowserRouter
  App.tsx                     # 路由表（Routes/Route）
  api.ts                      # axios/fetch 封装（从 interface endpoints 生成）
  hooks.ts                    # useQuery/useMutation hooks（从 logic 生成）
  pages/
    OrderList.tsx             # 每个 page → 一个组件
    OrderCreate.tsx
    OrderDetail.tsx
  types/index.ts              # 实体/结构 TS 类型（已有）
```

### 6.2 ViewElement → React 映射

| ViewElement | React 生成 |
|-------------|-----------|
| `page` | `export default function OrderList() { ... }`（组件） |
| `table dataSource={q}` | `<table>{q.data.map(row => <tr>...</tr>)}</table>` + 列 |
| `column field="x"` | `<td>{row.x}</td>`（header 用字段名） |
| `button action={useMutation(...)}` | `<button onClick={() => mutation.mutate()}>` |
| `button action={navigate(...)}` | `<button onClick={() => nav('/OrderDetail/'+id)}>`（Link/useNavigate） |
| `form submit={useMutation(...)}` | `<form onSubmit={...}>` + 受控 input state |
| `input field="x"` | `<input value={form.x} onChange={...} />` |
| `repeat field="items"` | 明细数组 → 动态行渲染 |
| `text field="x"` | `<span>{data.x}</span>` |

### 6.3 数据绑定生成

- `useQuery('listOrders')` → `const { data } = useQuery(listOrders);`（hooks.ts 提供，真实 fetch GET endpoint）。
- `useMutation('deleteOrder', row.id)` → `const del = useMutation(deleteOrder);` → `del.mutate(row.id)`。
- `$data` → query 结果变量；`$route` → `useParams()`；`row` → map 循环变量。
- `navigate('OrderDetail', { id: row.id })` → `useNavigate()` → `nav('/orders/'+row.id)`。

### 6.4 路由生成

- 每个 `page` 一个路由：`<Route path="/orders" element={<OrderList/>} />`。
- path 规则：页面名 camelCase → kebab（`OrderList` → `/orders`、`OrderDetail` → `/orders/:id`）。
- 详情页带 `:id` 参数（`navigate('OrderDetail', {id})` 的 args 决定）。

### 6.5 与现有 appFile 的关系

- 删除固定模板 `appFile`（被 page 声明替代）。
- 若 TDSL 无任何 `page`：保留现有默认单页生成（兼容，不破坏旧 demo）——或要求必须有 page。
  **决策：有 page 用声明式，无 page 退化为现有模板**（渐进，不破坏已提交的 order demo）。

---

## 7. 变更清单

| 包 | 文件 | 变更 |
|----|------|------|
| core | `src/types.ts` | `ViewNode`/`ViewElementNode`/`BindingNode` + `AppNode.views` + `AnyNode` |
| core | `src/path.ts` | `collectPaths` 增加 views 路径（`app.views.<name>`） |
| parser | `src/parser.ts` | `parsePage` + `page` 关键字 + JSX 子集 + binding link |
| parser | `test/parser.test.ts` | page 语法 + binding 绑定 + 悬空报错 |
| typecheck | `src/index.ts` | 组件类型/useQuery/useMutation/navigate 校验 |
| typecheck | `test/typecheck.test.ts` | View 校验 |
| codegen-react | `src/index.ts` | 路由/页面组件/数据绑定生成（替换固定模板） |
| codegen-react | `test/codegen-react.test.ts` | page 快照 |
| example | `examples/todo-app/todo.tdsl` | 订单场景改造成 page 声明式 |

---

## 8. 边界

| 项 | 本切面 | 说明 |
|----|--------|------|
| page 声明 + ViewNode IR | ✅ | 核心 |
| table/column/button/form/input/repeat/text/detail 组件 | ✅ | 核心 |
| useQuery/useMutation/navigate 绑定 | ✅ | 核心 |
| 多页面路由 + 导航 | ✅ | 核心 |
| dialog/block 页面类型 | ❌ | viewKind 预留，后续 |
| 复杂组件（图表/富文本/拖拽） | ❌ | M6 `component` 注册 |
| 表单校验（ValidationRule） | ❌ | P2 |
| 分页/排序 UI | ❌ | M2 查询语言之后 |

---

## 9. 测试策略

- **parser**：page + JSX 子集；useQuery/useMutation/navigate binding 绑定；悬空 logic/页面报错。
- **typecheck**：未知组件类型/悬空 binding 校验。
- **codegen-react**：快照——路由表、页面组件、hooks/api 生成。
- **集成（slice.ts）**：todo.tdsl 含 page → 双端 build + 浏览器访问三个页面。

---

## QA 记录（本切面）

| 序号 | 问题 | 结论 | 状态 |
|------|------|------|------|
| 1 | 页面布局怎么写？ | `page` + JSX 子集（table/column/button/form/input/repeat），parser 解析为 ViewNode | 已决策 |
| 2 | 数据绑定怎么表达？ | `dataSource={useQuery('logic')}` / `action={useMutation(...)}` / `navigate(...)` → BindingNode | 已决策 |
| 3 | 多页面怎么办？ | 每 page 一个组件 + React Router 路由表 + useNavigate | 已决策 |
| 4 | 现有固定模板 appFile？ | 有 page 用声明式；无 page 退化为现有模板（渐进兼容） | 已决策 |
| 5 | 复杂组件？ | M6 `component` 注册（ViewElement type 引用外部组件） | 后续 |
| 6 | dialog/block？ | viewKind 预留，本切面只做 page | 后续 |