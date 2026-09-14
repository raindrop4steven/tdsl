# 附录 A. TDSL 完整文法（EBNF）

本文法与 `packages/parser/src/lexer.ts` 和 `packages/parser/src/parser.ts` 对齐。记号约定：`{ ... }` 零次或多次，`[ ... ]` 可选，`|` 选择，`'x'` 字面量终结符，`x | ...` 组内选择。

## A.1 词法

lexer 只产出五种 Token（`ident` / `number` / `string` / `punct` / `eof`）。`keyword` 不是独立 Token 类——所有关键字都只是 `ident` 的**保留值**，由 parser 按 `value` 区分（第 3 章 §3.6）。

```
Ident    = (letter | '_' | '$') { letter | digit | '_' | '$' } ;   // 例：Order、$route、_tmp
Number   = digit { digit | '.' } ;                                  // 例：0、3.14
String   = "'" { char } "'" | '"' { char } '"' ;                    // 两种引号都可；书写约定业务字符串用单引号
punct1   = '{' | '}' | '(' | ')' | '<' | '>' | '[' | ']' | ';' | ',' | '.' | ':' | '='
         | '+' | '-' | '*' | '/' | '@' | '!' ;
punct2   = '&&' | '||' | '<=' | '>=' | ':=' ;                       // ':=' 是 legacy 占位，保留仅为报"已废弃"专用错误
punct3   = '===' | '!==' ;                                          // 比较相等（无 == / !=）
```

注解（annotation）**不是**词法层面的 Token：`@pk` 是 `@`（单字符 punct）+ `pk`（ident）两个 Token，由 parser 在声明上下文按需消费（`ANN` 是语法层面的复合形态，不是 Token 类型）。

## A.2 顶层声明

```
App        = { TopDecl } EOF ;
TopDecl    = DataSourceDirective
           | DependencyDecl | EntityDecl | StructDecl | EnumDecl
           | FunctionDecl | InterfaceDecl | ViewDecl | ServiceDecl ;

DataSourceDirective = '@datasource' '(' String ')' ;   // 声明/切换当前数据源（无结束标记）
                                                    // @service(...) 暂存配置、@title('x')/@menu('m') 暂存视图元信息

AnnotationList = { ANN } ;          // @pk / @nullable / @unique / @export 等，按声明上下文解释
ANN        = '@' Ident [ '(' AnnArg { ',' AnnArg } ')' ] ;
AnnArg     = [ Ident '=' ] String | Number ;

DependencyDecl = 'dependency' ( 'java' | 'npm' ) String
                 [ 'as' Ident ]                                  // ns 命名空间（撞名消解）
                 [ 'import' Ident | 'import' '{' ImportList '}' ] ';' ;
ImportList = Ident [ 'as' Ident ] { ',' Ident [ 'as' Ident ] } ;

EntityDecl = 'entity' Ident '{' { Ident ':' TypeRef AnnotationList ';' } '}' ;
StructDecl = 'struct' Ident '{' { Ident ':' TypeRef ';' } '}' ;
EnumDecl   = 'enum' Ident '{' EnumItem { ',' EnumItem } '}' ;
EnumItem   = Ident [ '(' String ')' ] ;                           // KEY('中文标签')

FunctionDecl = 'function' Ident '(' Params ')' ':' TypeRef Block ;
Params     = [ Param { ',' Param } ] ;
Param      = Ident ':' TypeRef ;

InterfaceDecl = 'interface' Ident '{' { Endpoint } '}' ;
Endpoint   = ('GET' | 'POST' | 'PUT' | 'DELETE') String '-' '>' Ident ';'
                                                        ;         // 箭头是 '-' '>' 两个 token（上下文分派）
ViewDecl   = ('page' | 'dialog') Ident '{' { ViewElement } '}' ;

ServiceDecl = '@service' '(' { Ident '=' String, } ')' 'service' Ident
              '{' { ServiceOp } '}' ;                             // kind = 'dubbo' | 'http'（必填）
ServiceOp  = [ ('GET' | 'POST' | 'PUT' | 'DELETE') String '-' '>'
             | Ident '(' Params ')' [ ':' TypeRef ] ';' ] ;       // http 形态带 method+path
```

## A.3 JSX 子集

```
ViewElement = '<' Ident { Attr } ( '/>' | ( '>' {Text} { ViewElement } '</' Ident '>' ) ) ;
Attr        = Ident '=' ( '{' Expr '}' | String ) ;   // attr={expr} 或 attr="str"
Text        = 任意非 '<' 字符（被跳过，不进 AST）;
```

闭合标签必须与开始标签同名（`mismatched closing tag` 校验）。递归下降的终止条件是 `</`：`<` 打头且紧跟 `/` 就不是新元素而是闭合标签。文本节点不保留在 AST 中（`props` 里的 `text="..."` 是属性而非子文本）。

## A.4 类型引用

```
TypeRef    = PrimitiveType | GenericType | DbType | RefType ;
PrimitiveType = 'String' | 'Integer' | 'Decimal' | 'Boolean' | 'Date' | 'Time' | 'DateTime' ;
GenericType   = ('List' | 'Map' | 'Page') '<' TypeRef [ ',' TypeRef ] '>' ;
DbType        = 'Decimal' '(' Number ',' Number ')' ;   // → { kind:'db', builtin:'decimal', args:{precision,scale} }
RefType       = Ident [ '.' Ident ] ;                  // 短名（Order）或限定名（erp.Order），link 后绑为 nodePath
```

补充：`Object` 也写作 `RefType`（按 Ident 解析成 reference），typecheck 对 `path === 'Object'` 特判放行（"任意类型"通配符），它**不是** PrimitiveType。

## A.5 语句

```
Block    = '{' { Stmt } '}' ;
Stmt     = 'const' Ident [ ':' TypeRef ] '=' Expr ';'            // VarDecl
         | Expr '=' Expr ';'                                     // Assign（赋值只用 =，不是 ===）
         | 'if' '(' Expr ')' Block [ 'else' Block ]
         | 'for' '(' 'const' Ident 'of' Expr ')' Block           // 唯一循环形态（无 while/do/for-i）
         | 'return' [ Expr ] ';'
         | 'throw' Expr ';'                                      // 最小异常面（无 try-catch）
         | Expr ';' ;                                            // CallStmt / 副作用调用
```

TDSL 只有七种语句（对应 `core/statement.ts`），刻意砍掉了 `while`、下标 `for`、`break`、`continue`。`for-of` 是唯一循环（`ForEach` 节点），`Assign` 的左边是任意 Expr（左值合法性交由 typecheck/codegen 判断，parser 不区分——这是为绕开 LL(1) FIRST 集合冲突做的取舍，见第 4 章 §4.3）。

## A.6 表达式

```
Expr              = OrExpr ;
OrExpr            = AndExpr { '||' AndExpr } ;
AndExpr           = EqualityExpr { '&&' EqualityExpr } ;
EqualityExpr      = RelationalExpr { ('===' | '!==') RelationalExpr } ;
RelationalExpr    = AdditiveExpr { ('<' | '<=' | '>' | '>=') AdditiveExpr } ;
AdditiveExpr      = MultiplicativeExpr { ('+' | '-') MultiplicativeExpr } ;
MultiplicativeExpr= PostfixExpr { ('*' | '/') PostfixExpr } ;
PostfixExpr       = Primary { '.' Ident | '(' Args ')' } ;      // 成员访问与调用，无下标语法
Primary           = '(' Expr ')'
                   | 'new' TypeRef '(' Args ')'                  // 对象构造
                   | 'new' ('List' '<' TypeRef '>') '(' ')'      // 空列表
                   | '[' { Expr , } ']'                          // 数组字面量（in 条件右值）
                   | Number | String | 'true' | 'false' | 'null'
                   | Ident ;
Args              = [ Expr { ',' Expr } ] ;
```

要点：

- 优先级链 7 层（`||` 最低 → postfix 最高），与第 4 章 §4.5 的表一致。
- **没有一元运算符**（无 `!`、无负号一元）：逻辑非写 `x === false`；负数 `-1` 需写 `0 - 1`（或 `new Decimal(...)` 上下文内合法）。这是刻意的"小语言"取舍（第 4 章 §4.5）。
- **没有下标 `list[0]`**——列表访问一律 FFI 方法（`get(0)`）。`[...]` 只作为数组字面量（`NewList`）出现在 primary。
- `==` / `!=` 不存在，比较相等只有 `===` / `!==`。
- `=`、`like`、`in` **不属于**通用表达式——它们在查询条件（A.7 `WhereCond`）里用专用解析处理，因此 `x = 5` 作为表达式不合法、必须写成赋值语句。

## A.7 查询语言（形态分派）

查询不是语法扩展，而是 `parseCallArgs` 依据接收者形态做的**实参解析分派**（第 5 章）：

```
QueryChain = EntityRef '.' 'where' '(' WhereArgs ')'                 // EntityRef = Ident [ '.' Ident ]
           | QueryChain '.' ('orderBy'|'limit'|'page'|'groupBy') '(' ChainArgs ')' ;

WhereArgs  = WhereCond { ',' WhereCond } ;          // 逗号 = AND
WhereCond  = Field Op Value
           | Expr '&&' Expr | Expr '||' Expr ;      // 复合：沿用通用 Binary（&&/|| 仍走 parseAdditive 终止技巧）
Field      = Ident ;
Op         = '=' | '>=' | '<=' | '>' | '<' | 'like' | 'in' ;
Value      = Additive | '[' Expr { ',' Expr } ']' ;  // in 的右值可以是数组字面量

ChainArgs  = orderBy:   Ident [ 'asc' | 'desc' ] { ',' Ident [ 'asc' | 'desc' ] }
           | limit:     Number
           | page:      Number ',' Number
           | groupBy:   Ident { ',' Ident } ;
```

聚合 `aggregate` 的 `sum(f)` / `avg(f)` / `max(f)` / `min(f)` / `count()` 以 FFI 目录成员（或实体静态方法）形式解析，文法上就是普通 `Ident '(' Ident ')'` 调用。

## A.8 语义约束（非文法）

以下约束不在 EBNF 文法中，由 typecheck 在 `check()` 中校验（第 6 章）：

1. `reference` 类型必须可 `resolve`（`Object` 除外）。
2. `ForEach` 容器必须是可迭代的 List（实体查询 / 已知变量 / 调用 / 成员）。
3. `Endpoint.logicRef` 必须解析到存在的 Logic。
4. 实体静态方法（`Order.where`/`get`/`all`/`delete`）与查询链的各环节字段、运算符、聚合白名单。
5. 绑定逻辑必须被 interface 端点暴露（`useQuery/useMutation/navigate` 目标）。
6. 依赖声明与使用的一致性（D-dep-1/2/3/4）。
7. 外部服务 kind 合法；http 操作必带 method + path。