# 03 typecheck：最小类型检查

> 配套代码：`packages/typecheck/src/index.ts`（单文件）
> 定位：按 P0 设计只做最小验证 —— **引用绑定检查 + ForEach 容器规则**。完整类型检查（推导/泛型/隐式转换）是 P1。

## 1. 数据流

```
AppNode（已 link，引用都是完整路径）
   │  check(app)
   ├─ ① 遍历所有 TypeRef → resolve 每个 reference，悬空报 Diagnostic
   ├─ ② 遍历所有 ForEach → 容器必须是 X.all（X 为实体）
   └─ 返回 { ok, diagnostics }
```

## 2. 输出类型（Diagnostic）

```ts
interface Diagnostic {
  path: string;          // 出错节点的 nodePath（必填）
  line?: number;         // P1 引入源映射后才有
  col?: number;
  message: string;
  severity: 'error' | 'warning';
}
```

**关键点：`path` 是必填的 nodePath** —— 错误是**可编程寻址**的：调用方拿到 `path` 就能 `resolve` 回出错节点继续处理（LLM 修复管线、编辑器高亮都能用），不是"第 3 行有错"这种文本。

## 3. ① 遍历器：forEachTypeRef + visitExprTypes

检查引用绑定需要"走遍整棵树，摸到每个 TypeRef"。树有嵌套（实体属性、逻辑体语句、语句里的表达式、表达式里的 `new List<T>()`），所以遍历器递归：

```ts
function forEachTypeRef(app, fn) {
  const visit = (tr, owner) => {          // tr: TypeRef, owner: 持有它的节点
    fn(tr, owner);
    if (tr.kind === 'generic')            // List<Todo> 里的 Todo 也是引用，递归进去
      tr.args.forEach(a => visit(a, owner));
  };
  // 实体属性 → 结构属性 → 逻辑参数/返回
  // 语句/表达式里的类型（如 new List<Todo>() 的 elem）走 visitExprTypes
}

function visitExprTypes(e, owner) {
  switch (e.kind) {
    case 'New':      visit(e.type, owner); e.args.forEach(a => visitExprTypes(a, owner)); break;
    case 'NewList':  visit(e.elem, owner); e.items.forEach(a => visitExprTypes(a, owner)); break;
    // Call/Member/Binary/Group 递归子表达式
    // Ident/字面量 → 无类型，跳过
  }
}
```

**`owner` 参数很关键**：每个 TypeRef 带着"它属于谁"，报错时能给出**出错的节点路径**，而非笼统的"某处有错"。

## 4. ② 检查规则 1：悬空引用

```ts
forEachTypeRef(app, (tr, owner) => {
  if (tr.kind === 'reference' && !resolve(app, tr.path)) {
    diagnostics.push({
      path: nodePathOf(app, owner) ?? 'app',
      message: `悬空引用: ${tr.path}`,
      severity: 'error',
    });
  }
});
```

`resolve` 返回 null = 路径在树里找不到 = 悬空引用。

**为什么 parser 查过了 typecheck 还要查？** 因为 AST 不只有 parser 一个来源 —— P1 有 JSON 直出通道（LLM 直出 JSON AST → zod 校验 → Typed AST），那条通道**绕过 parser**，引用路径可能是手写的、会悬空。**typecheck 是任何入口进 AST 后的统一安全网。**

## 5. ③ 检查规则 2：ForEach 容器必须是 X.all

```ts
if (st.kind === 'ForEach') {
  const c = st.container;
  const isEntityAll =
    c.kind === 'Member' &&
    c.obj.kind === 'Ident' &&
    c.prop === 'all' &&
    resolveEntity(app, c.obj.name) !== null;
  if (!isEntityAll) → 报错
}
```

这条规则很"TDSL 特定"：书写层 `for (todo in Todo.all)` 里 `Todo.all` 是**实体静态集合引用**的语法糖（类似 `TodoRepository.findAll()` 的 DSL 表达）。编译器必须验证：容器形状是 `X.all`，且 `X` 确实是个已声明的实体。`for (x in something.else)` 或 `for (x in Todo)` 都会在这里被拒 —— **语法合法但语义非法**的典型例子。

## 6. 返回结果

```ts
return { ok: diagnostics.length === 0, diagnostics };
```

`ok` 给调用方（slice.ts）快速判断，`diagnostics` 是详细信息。

## 7. 测试策略（3 个用例）

1. **合法 app** → `ok: true`（用 parser 解析的完整 demo）
2. **手工构造悬空引用 AST** → 报"悬空引用"（**模拟 JSON 直出通道的坏输入**：不用 parser，直接 `createNode` 手工拼 AST、塞不存在的引用路径 —— 验证 typecheck 独立于 parser 工作）
3. **非法 ForEach 容器** → 报"容器必须是实体 .all"

## 8. 本包要记住的 3 件事

1. **诊断带 nodePath**，不是文本报错 —— 可编程寻址，为编辑器/LLM 修复管线铺路。
2. **typecheck 是统一安全网**：parser、JSON 直出、任何入口进 AST 后都过这一关。
3. **最小版只做两件事**（引用绑定 + ForEach 规则）；推导/泛型/隐式转换是 P1 完整版。