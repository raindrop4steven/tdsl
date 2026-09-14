# 附录 C. 术语表

## 编译原理基础

| 术语 | 英文 | 定义 | 对应章节 |
|------|------|------|---------|
| 抽象语法树 | AST (Abstract Syntax Tree) | 去掉语法噪音、只保留语义骨架的语法树 | 2 |
| 具体语法树 | CST (Concrete Syntax Tree) | 完整保留语法结构的分析树 | 2 |
| 中间表示 | IR (Intermediate Representation) | 源语言与目标语言之间的表示层 | 8 |
| 词法分析 | Lexing | 字符流 → Token 流 | 3 |
| 语法分析 | Parsing | Token 流 → AST | 4, 5 |
| 语义分析 | Semantic Analysis | 验证语法正确之外的语义约束 | 6 |
| 类型检查 | Type Checking | 验证表达式类型与上下文类型约束的一致性 | 6 |
| 符号表 | Symbol Table | 名字 → 定义的映射结构 | 7 |
| 作用域 | Scope | 名字的可见范围 | 7 |
| 代码生成 | Code Generation | AST/IR → 目标语言 | 8–10 |
| 递归下降 | Recursive Descent | 每个非终结符对应一个解析函数的下降解析法 | 4 |
| 文法 | Grammar (CFG) | 描述语言的产生式集合 | 4 |
| 正则语言 | Regular Language | 可以被有限自动机识别的语言 | 3 |
| 有限自动机 | DFA/NFA | 识别正则语言的计算模型 | 3 |
| 上下文无关文法 | CFG | 描述程序语言语法的文法 | 4 |
| 判别联合 | Discriminated Union | 带类型标签的联合类型（TS 的 ADT） | 2 |
| never 类型 | Never Type | 不可能存在的值类型（穷尽性检查的基础） | 2, 8 |
| 左递归 | Left Recursion | 产生式左部直接（间接）出现再次从左开始的情形 | 4 |
| 优先级爬升 | Precedence Climbing | 用递归层次编码运算符优先级的解析法 | 4 |

## TDSL 特有设计

| 术语 | 英文 | 定义 |
|------|------|------|
| 唯一事实来源 | SSoT (Single Source of Truth) | Typed AST 是整个 TDSL 语义的唯一权威表示 |
| nodePath | — | 以点号分隔的 AST 寻址路径字符串，如 `app.datasources.erp.entities.Order` |
| linkApp | — | parser 的链接阶段：短名 → nodePath 绑定 |
| 形态分派 | Morphological Dispatch | 按调用点接收者+方法名选择实参解析策略（查询语言的关键） |
| 查询链 | Query Chain | `X.where(...).orderBy(...).page(...)` 的可链式调用形态 |
| QuerySpec | Query Specification | codegen-java 对查询形态的归集与编译单元 |
| 宽松放行 | Lenient Pass | typecheck "无法静态推导就不报错"的策略 |
| 有效目录 | Effective Catalog | 内核五域 ∪ 声明依赖产物类的合并索引 |
| FFI 内核五域 | FFI_CORE | String/Decimal/Date/DateTime/List 五个语言自有外部域 |
| 目录产物 | Loaded Catalog | bundle-jar 扫描 + 人工收窄的第三方能力清单（libs/*.json） |
| 声明驱动 | Declaration-driven | pom/package.json 依赖由 dependency 声明决定，不反向推导 |
| 别名撞车 | Collision | 两个目录类共享同一 alias（D-dep-4 诊断） |
| 类型映射 | Type Mapping | TypeRef → 目标语言类型的语义保持翻译 |
| 对拍 | Snapshot Diff | 多文件合并 AST 与等价单文件 AST 的逐节点比较 |
| enums import | wildcard import | 无枚举 app 不生成 enums 包 import 的生成细节 |

## 生态与工具

| 术语 | 定义 |
|------|------|
| TDDB | 测试驱动的编译器开发：单测锁定行为、示例锁定可编译性、E2E 锁定端到端 |
| E2E | 端到端：`npm run slice` 把 todo.tdsl 跑成双端可编译工程 |
| M1/M2/M4/... | 里程碑编号（命名空间/查询/View/...），见 `docs/dev/` |
| D-dep-1~4 | 依赖声明四种诊断（未声明/无产物/版本漂移/撞别名） |
| TdslSyntaxError | lexer/parser 抛出的语法错误（携带行列） |
| Diagnostic | typecheck 的检查结果单元（path/line/col/message/severity） |