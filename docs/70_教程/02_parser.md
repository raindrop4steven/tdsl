# 02 parser：文本 → AST

> 配套代码：`packages/parser/src/`（`lexer.ts` + `parser.ts`）
> 定位：最"脏"的部分 —— 把 TDSL 文本变成干净的 Typed AST。

## 1. 数据流

```
todo.tdsl 文本
   │  ① lexer.ts   tokenize()
   ▼
Token 流  [{ident:'entity'}, {ident:'Todo'}, {punct:'{'}, ...]
   │  ② parser.ts  parse() → Parser 类递归下降
   ▼
原始 AST（引用还是短名 'Todo'）
   │  ③ parser.ts  linkApp()  短名 → nodePath
   ▼
干净 AST（引用是 'app.datasources.defaultDS.entities.Todo'）
```

## 2. ① lexer.ts —— 词法分析（文本 → Token）

```ts
interface Token {
  type: TokenType;   // 'ident' | 'string' | 'number' | 'punct' | 'eof'
  value: string;     // 实际文本，如 'entity' / 'Todo' / '{'
  line: number;      // 行列用于错误定位
  col: number;
}
```

实现是 while 循环 + 逐字符判断：跳过空白/注释 → 读字符串字面量 → 读数字 → 读标识符 → 读运算符（先试三字符 `===`/`!==`，再双字符 `&&`/`||`/`<=`/`:=`，最后单字符）。

关键设计：

1. **关键字不单独设类型** —— `entity`/`if`/`for` 全部作为 `'ident'` 返回，由 parser 判断 `value === 'entity'`。因为"哪些词是关键字"是语法层决策，塞进词法层会让 lexer 和语法规则耦合。lexer 只管"这是一个单词"。
2. **每产生一个 Token 记录行列** —— 这是语法错误能报 `(line 3, col 10)` 的根源。
3. **未知字符直接 throw** —— `unexpected char '#' at 3:10`，最底层挡掉非法输入。

## 3. ② parser.ts —— 递归下降（Token → AST）

核心是 `Parser` 类，维护 `pos` 游标（当前 Token 位置），每个语法规则对应一个方法，规则套规则变成方法调方法 —— 这就是"递归下降"名字的由来。

### 3.1 顶层 parseApp()

```ts
parseApp() {
  while (未到文件尾) {
    if (遇到 '@')  → 注解：@datasource 切换数据源，@export 跳过
    if (遇到 'entity') → parseEntity()，塞进当前数据源
    if (遇到 'struct') → parseStructure()
    if (遇到 'enum')   → parseEnum()
    if (遇到 'logic')  → parseLogic()
  }
}
```

注意 `@datasource('defaultDS')` 声明之后，后续所有 entity 归这个数据源（`currentDs` 变量）；无 `@datasource` 时默认建 `defaultDS`。

### 3.2 基础辅助方法

```ts
peek()   // 看当前 Token，不消费
next()   // 消费并返回当前 Token
expect('{')  // 断言下一个 Token 是 '{'，否则抛 TdslSyntaxError
```

`expect` 是错误定位的关键：`expected '(' but got 'logic' (line 15, col 1)` 就是它抛的。

### 3.3 声明解析 + 语法糖归一

以 `parseEntity` 为例：

```ts
parseEntity() {
  expect('entity');
  const name = expectIdent();
  expect('{');
  while (还没到 '}') {
    const pname = expectIdent();   // 字段名
    expect(':');
    const type = parseTypeRef();   // 类型 'Integer' / 'List<Todo>'
    while (遇到 '@') { ... prop.primary = true; }   // @pk @nullable @unique
    expect(';');
  }
  expect('}');
  return { ...createNode('Entity'), name, properties };
}
```

**语法糖归一**已在这里发生：`id: Integer @pk` 被归一成结构化 AST：

```ts
{ kind: 'EntityProperty', name: 'id',
  type: { kind: 'primitive', builtin: 'Integer' },
  primary: true }
```

书写层的糖，变成语义核里的结构化信息。

### 3.4 表达式解析 —— 优先级爬升（最有技巧的部分）

表达式解析靠一组按优先级排列的方法（precedence climbing）：

```ts
parseExpr()   → parseOr()          // 优先级最低
  parseOr()       → 处理 '||'
    parseAnd()      → 处理 '&&'
      parseEquality()   → 处理 '===' '!=='
        parseRelational() → 处理 '<' '<='
          parseAdditive()   → 处理 '+'
            parsePostfix()    → 处理 '.xxx' 和 '(args)'
              parsePrimary()   → 字面量/标识符/new/(...)
```

每个方法先解析"比自己高一级"的表达式，再循环处理自己的运算符，自然得到正确的优先级树。

以 `parsePostfix`（后缀链）为例：

```ts
parsePostfix() {
  let e = parsePrimary();          // 先解析基础：Ident 'result'
  for (;;) {
    if (遇到 '.') { e = { kind:'Member', obj:e, prop:名字 }; }          // result.add
    else if (遇到 '(') { e = { kind:'Call', callee:e, args:[...] }; }   // result.add(todo)
    else break;
  }
  return e;
}
```

`result.add(todo)` 一次解析成嵌套结构：

```ts
{ kind: 'Call',
  callee: { kind: 'Member', obj: { kind: 'Ident', name: 'result' }, prop: 'add' },
  args: [ { kind: 'Ident', name: 'todo' } ] }
```

### 3.5 语句解析（parseStatement）

按开头关键字分流：`return` → Return；`if` → If（条件 + then 块 + 可选 else）；`for` → ForEach（item in container）；其他先解析表达式，再看后续：`:=` → VarDecl、`=` → Assign、`;` → CallStmt。这就是 `:=` 归一为 VarDecl 的地方。

## 4. ③ linkApp() —— 短名 → nodePath（体现设计意图的部分）

解析完的 AST 里类型引用还是短名（`List<Todo>` 里的 `Todo`）。`linkApp` 替换成完整 nodePath：

```ts
function linkApp(app) {
  // 第一步：建"短名 → 完整路径"表
  //   Todo → app.datasources.defaultDS.entities.Todo
  //   TodoInput → app.structures.TodoInput
  // 第二步：遍历整棵 AST，把所有 reference 的 path 就地替换为完整路径
  linkTypeRef(tr) {
    if (tr.kind === 'reference') {
      const full = nameToPath.get(tr.path);
      if (!full) throw new TdslSyntaxError(`cannot resolve type '${tr.path}'`);
      tr.path = full;
    }
  }
}
```

**为什么有这一步？** LLM 写短名 `Todo`（人类直觉），但语义核约定引用必须存完整 nodePath（D3：改名只改一处，编译器捕获悬空引用）。解析时可能引用尚未声明的类型（struct 在前、entity 在后），所以解析完、全树信息齐了，再统一绑定。**悬空引用的第一道防线也在这里**（`cannot resolve type 'Missing'`）。

### 已知限制：短名全局唯一（P1 演进）

当前 `nameToPath` 要求**整个 app 内短名唯一**，重名抛 `duplicate type name 'Todo'`。这是临时策略（书写层无命名空间前缀语法，歧义无法消歧，宁可拒绝不可错绑）。P1 改为作用域感知解析 + `ds1.Todo` 前缀消歧（详见 `docs/dev/QA记录.xlsx` #9）。

## 5. 错误处理：TdslSyntaxError

```ts
class TdslSyntaxError extends Error {
  constructor(message, public line, public col) { ... }
}
```

所有语法错误带行列，且是**解析期就抛**（不是返回错误值）——让非法输入在最早阶段中断。

## 6. 本包要记住的 3 件事

1. **lexer 只管切词**（含行列），关键字判断留在 parser —— 分层清晰。
2. **递归下降 + 优先级爬升**：每个语法规则一个方法，表达式靠方法嵌套天然得到优先级。
3. **link 阶段做符号绑定**：短名 → nodePath，让 AST 里的引用始终是完整路径（语义核约定）。