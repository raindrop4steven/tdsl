# 05 codegen-react：前端生成

> 配套代码：`packages/codegen-react/src/index.ts`（单文件）
> 定位：比 codegen-java 小得多 —— P0 范围 React 端只做两件事：**Entity → TS 类型定义** + **固定模板组件**。没有 View/JSX 解析（P1）。

## 1. 主入口：generateReact

```ts
function generateReact(app): GeneratedFile[] {
  const entity = app.datasources[0]?.entities[0];   // demo: 取第一个实体
  return [
    ...projectFiles(app),        // package.json / vite.config.ts / tsconfig.json / index.html / main.tsx
    ...(entity ? [typesFile(entity), appFile(app, entity)] : []),
  ];
}
```

对照 codegen-java：Java 端遍历**所有**实体生成 N 个文件；React 端 P0 只取**第一个**实体（demo 简化，P1 多实体/多 View 时改成遍历）。

## 2. 脚手架文件：projectFiles（固定模板）

生成 5 个工程骨架文件，**与 AST 无关**（除了 app 名字）：

- `package.json`（react 17.0.2 + vite 7.3.6 + typescript）—— 版本探测过 npm 镜像源后锁定
- `vite.config.ts`
- `tsconfig.json`（`jsx: react-jsx`、`strict: true`）
- `index.html`
- `src/main.tsx`（React 17 写法：`ReactDOM.render`，不是 18 的 `createRoot`）

这些是**工程基建** —— 保证产物是"完整可 build 的 Vite 工程"，不是零散 TSX 片段。这是"真实 build 通过"验收的地基。

## 3. Entity → TS 类型：typesFile（数据驱动）

React 端**真正由 AST 驱动**的部分：

```ts
// AST: Entity Todo, properties: [{id:Integer @pk}, {title:String}, {done:Boolean}]
→
export interface Todo {
  id: number;
  title: string;
  done: boolean;
}
```

翻译表 `tsType(tr)`：

| TypeRef | TS |
|---------|-----|
| `Integer` | `number` |
| `Decimal` | `number` |
| `String` | `string` |
| `Boolean` | `boolean` |
| `Date`/`Time`/`DateTime` | `string`（ISO 字符串约定） |
| `reference` | 引用类型名（最后一段 path） |
| `generic List<T>` | `Array<T>` |

**注意语义映射**：TDSL 的 `Decimal` 到 TS 没有精确小数类型 → `number`；日期 → `string`（ISO 约定，对应 Java 端 `LocalDate` 序列化）。平台差异在生成器翻译。

## 4. 固定模板 + 字段注入：appFile

P0 的 React 组件是**固定模板 + 实体字段注入** —— 不解析 View/JSX：

```ts
function appFile(app, ent) {
  // 注入 1：实体名 → 组件标题 "Todo List"、类型引用 import
  // 注入 2：实体字段 → MOCK_DATA 示例值
  const sampleFields = ent.properties
    .map(p => `    ${p.name}: ${sampleValue(p.type)}`)  // id: 0, title: 'sample', done: false
    .join(',\n');
  → <App/> 模板里：
  const MOCK_DATA: Todo[] = [{ id: 0, title: 'sample', done: false }];
}
```

**`sampleValue(tr)` 是第二张数据驱动映射表** —— 每个 TypeRef 给一个示例值：

```ts
Boolean → false    Integer → 0    String → 'sample'    generic → []
```

**为什么这样设计？** P0 不解析 View，但组件总得渲染点东西。方案：**模板负责结构（列表渲染 + JSON.stringify），AST 负责数据（字段名 + 示例值）**。这样：

1. **组件展示是真实 AST 驱动的** —— 实体加个字段，MOCK_DATA 和 interface 自动跟着变。
2. **渲染逻辑用 `JSON.stringify(item)` 展示任意实体的任意字段** —— 模板不硬编码 `todo.title`，换实体也不用改模板。

## 5. 测试（5 个用例）

1. 脚手架文件齐全
2. TS 类型正确（`title: string` 等）
3. App.tsx 注入正确（`Todo List`、`useEffect`、`JSON.stringify`）
4. **main.tsx 是 React 17 写法**（`ReactDOM.render`，无 `react-dom/client`）—— 修过一次 bug 后锁定的断言
5. 确定性

## 6. 本包要记住的 3 件事

1. **固定模板 + 数据注入**：脚手架是死的，实体类型和示例数据是活的（AST 驱动）。
2. **示例值映射 `sampleValue`**：TypeRef → 示例数据，和 `tsType` 并列，是 React 端第二张翻译表。
3. **模板不硬编码字段**：`JSON.stringify(item)` 让组件对任意实体通用 —— P0 不做 View 解析下的最小正确设计。