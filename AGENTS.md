# AGENTS.md — TDSL 项目约定（AI 编码助手工作手册）

> 面向对象：在本仓库工作的 AI 编码助手（及新加入的开发者）。
> 深入学习项目请读 `docs/70_教程/06_项目Tour-功能全景.md`（基于最新代码的功能全景 + 逐包源码导读）。
> 跨会话状态（决策历史/踩坑/用户偏好）见根目录 `memory.md`——每次重要节点后主动追加维护。

## 1. 项目定位

自研低代码 DSL（TDSL）：**大模型/人写 TS 风格 DSL（书写面；非严格 TS 子集——表达式/控制流照 TS 手感，
entity/page/where 等为领域扩展，`:=` 与 for-in 是两处有意偏离，tsc 不适用，自家 parser 为权威校验）→ parser → Typed AST（语义核/SSoT）→ typecheck → codegen → React + Java**。
对标网易 CodeWave NASL（调研见 `docs/00_参考资料/NASL调研.md`），但用强类型 AST 替代 JSON AST 作唯一事实来源。

```
todo.tdsl ──parse──▶ Typed AST ──typecheck──▶ codegen-java ──▶ Spring Boot 工程（mvn compile ✓）
                  (@tdsl/parser)  (@tdsl/core)  (@tdsl/typecheck) └─ codegen-react ──▶ Vite+React 工程（vite build ✓）
```

## 2. 当前进度（2026-09 实测，139 单测全绿）

| 里程碑 | 状态 |
|--------|------|
| P0 五包闭环 + Todo demo | ✅ |
| P1 CRUD（interface/Controller/真实 fetch） | ✅ |
| P2 复杂逻辑（运算符/List 方法/where 单条件/@Transactional/Decimal 算术/扁平表外键） | ✅ |
| M1 命名空间（实体→数据源作用域、限定名 `ds.Entity`、歧义报错） | ✅ |
| M4 View 声明层（`page` + JSX 子集、useQuery/useMutation/navigate、多页面路由、antd 映射） | ✅ |
| M6 外部能力（`service` dubbo/bean/http → 注入；`component` npm 组件注册） | ✅ |
| M2 查询语言（where 复合条件、orderBy/page/limit、aggregate+groupBy） | ✅ |
| P2 LLM Prompt Pack（示例矩阵/prompt 组装/诊断修复闭环，`packages/llm`，13 单测） | ✅ |
| P2 Playground（浏览器试验台：Monaco + 实时诊断/AST/双端代码，`packages/playground`，6 单测） | ✅ |
| M3 逻辑补全+typecheck 加深 / M5 数据完整性 / P2 llm·cli·playground | ⬜ 未开始 |

设计文档：`docs/dev/12~19`（各里程碑）；总路线：`docs/dev/14`；项目级设计：`docs/10_设计/设计总览.md`。

## 3. 核心工程约定（违反即打回）

- TypeScript **strict**，Node >= 18，npm workspaces（`packages/*`）；本机 Node 24 + npm 11（**无 pnpm**）。
- 节点用**判别联合 + `kind` 字面量**，生成器/编译器 switch 后 `never` 穷尽收窄——新增节点类型必须同步更新所有消费端，否则 TS 编译报错（这是设计而非负担）。
- 跨节点引用一律 **nodePath 字符串**（如 `app.datasources.erp.entities.Order`）+ 编译期 `resolve()` 绑定；悬空引用报 Diagnostic。
- codegen **纯函数/确定性输出**：返回 `GeneratedFile[]`（path+content）不碰磁盘；写盘只发生在 `examples/todo-app/scripts/slice.ts`。
- 错误带 nodePath + 行列：parser 抛 `TdslSyntaxError{line,col}`；typecheck 返回 `Diagnostic{path,line?,col?,message,severity}`。
- **禁止** `as any` / `@ts-ignore` / `@ts-expect-error`。
- 生成产物（`examples/todo-app/generated/`）独立构建，**不进 npm workspace**。
- 单测用 vitest；改任何包的行为必须同步补/改对应 `packages/*/test/*.test.ts`。

## 4. 常用命令

```bash
npm test              # 七包 vitest（139 个用例）
npm run typecheck     # 七包 tsc --noEmit
npm run slice         # 端到端：todo.tdsl → parse → typecheck → 双端 codegen → mvn compile + vite build
npm run playground    # 浏览器试验台：http://localhost:5173（左编辑 TDSL，右看诊断/AST/双端代码）
```

## 5. 目录速查

```
packages/
  core/            # 语义核：types.ts(全部节点)/expr/statement/typeref/symbols.ts(M1 分层符号表)/path.ts(nodePath)/id.ts
  parser/          # lexer.ts + parser.ts（递归下降 + linkApp 短名→nodePath 绑定）
  typecheck/       # check(app)：悬空引用/ForEach 容器/实体方法与查询链/View binding/外部能力 五类诊断
  codegen-java/    # generateJava：脚手架/Entity/Repository(QuerySpec 机制)/Structure/Service(@Transactional)/Controller/Feign
  codegen-react/   # generateReact：脚手架 + M4 真生成(api/hooks/pages/router，antd 组件映射)
  llm/             # Prompt Pack：examples.ts(示例矩阵，单测锁定可编译性)/prompt.ts(五层组装)/repair.ts(诊断回流修复)
  playground/      # 浏览器试验台：pipeline.ts(compile 纯函数管线) + Monaco 编辑器 + 四面板（诊断/AST/Java/React）
examples/todo-app/
  todo.tdsl        # ★最佳样本：订单场景，一个文件覆盖全部已完成能力
  scripts/slice.ts # 端到端驱动（66 行）
  generated/       # 产物（gitignore 性质，独立构建）
docs/
  00_参考资料/     # NASL 调研（NASL调研 + NASL设计原理调研汇报）
  10_设计/设计总览.md   # 项目级设计一份读完（原需求/系统/详细设计三份已合并删除）
  dev/11~19        # 切面级研发文档（11=M3 未来设计；12-19=已落地里程碑；QA记录.xlsx）
  70_教程/         # 00-05 P0 逐包讲解；06_项目Tour-功能全景（★最新全景）
```

## 6. 研发流程（enterprise-module-dev 技能适配）

- 开发新功能/模块按六阶段：**需求 → 设计 → 编码 → 测试 → 交付**，每阶段结束用 `question` 工具 Gate 确认，**禁止跳阶段**。
- 每个切面在 `docs/dev/` 下留编号文档（如 `19_系统设计-Mx-xxx.md`），含验收标准与 QA 记录。
- **文档适配**：本项目文档全为 markdown；HTML 审阅模式**降级为行内标记**：`<rv-add>` 新增 / `<rv-del>` 删除 / `<rv-chg>` 修改。QA 跟踪用 `docs/dev/QA记录.xlsx`。
- **文档索引 `docs/index.html` 每次新增/修改文档后同步更新**（教程类文档同时更新 `docs/70_教程/README.md` 目录）。

## 7. 常见任务指引

| 任务 | 做法 |
|------|------|
| 新增 DSL 语法 | core（类型+）→ parser（语法+link）→ typecheck（校验）→ codegen-java → codegen-react → 单测 → todo.tdsl 样例 |
| 新增节点类型 | 改 `core/types.ts` 判别联合后，**TS 编译会强制**你补齐所有 `never` 收窄点——顺着报错改完即闭环 |
| 新增查询形态 | parser `parseCallArgs` 分派 → typecheck `checkChainMethod` 白名单 → codegen-java `QuerySpec`/`derivedMethodName` |
| 新增页面组件 | parser `parseViewElement` 已通用；typecheck `KNOWN_VIEW_TYPES` + codegen-react `genElement`/`ANTD_OF` |
| 排查 typecheck 误报 | 当前策略是"宽松放行"（无法静态推导不报错）；确认是缺陷再收紧，避免破坏 demo |

## 8. 本机工具链

Node 24 + npm 11（无 pnpm）；Java 17 (Corretto) + Maven 3.8.5（Java 产物 build）；React 产物构建用 vite 5。
