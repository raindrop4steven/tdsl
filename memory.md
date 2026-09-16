# memory.md — 项目记忆（跨会话状态）

> 定位：**演进的记忆**，与 `AGENTS.md`（稳定的工作规则）互补。
> 维护约定：每个重要节点（切面交付/关键决策/踩坑）由 AI 主动追加；读项目的顺序是
> `AGENTS.md`（怎么干活）→ 本文件（干过什么）→ `docs/10_设计/设计总览.md`（设计是什么）。
> 最后更新：2026-09（M8 CLI 交付后）

---

## 1. 用户偏好与协作方式（历次会话沉淀）

- 按切面推进，严格遵守六阶段（需求→设计→编码→测试→交付），**每个 Gate 用简短三选一确认**（确认/还要修改/先放一放）；用户回复"OK/通过"即 Gate 通过，立即进入下一阶段。
- 用户喜欢**先读代码再下结论**：文档可能滞后于实现，写任何"现状/进度"前先实测（跑测试、读源码）。
- 结论先行、表格化、简洁；重要发现（文档与代码的偏差）要明说，不顺着旧文档错下去。
- 演示价值优先：**领导要看演示**——playground 提前于 CLI/LLM 接入就是为此。

## 2. 关键决策历史（按时间序）

| 时间 | 决策 | 背景 |
|------|------|------|
| 2026-09 | D4 口径修正：TDSL 是 **TS 风格 + 领域扩展**，非严格 TS 子集 | 实测 `:=`/for-in 过不了 tsc（TS1109）；"tsc 可辅助校验"收益不成立，自家 parser 为权威校验 |
| 2026-09 | LLM 教学采用"示例主导"三原则（demo-first/按域检索/parser-in-the-loop） | 小众语言 LLM 能力主要来自 few-shot 示例（80/20 方向性结论，出处待考证）；Grammar Prompting（NeurIPS 2023）佐证 |
| 2026-09 | 示例矩阵**单测锁定可编译性**（永不腐烂机制） | 防示例与 parser 演进脱节；首轮就抓到 external-service 示例漏字段的真实 bug，机制自证有效 |
| 2026-09 | typecheck 当前采用"宽松放行"策略 | 无法静态推导就不报错（误报率压零）；完整推导留 M3（dev/11 已设计） |
| 2026-09 | **Playground 提前于 CLI/真实 LLM 接入** | 领导演示需求；纯本地零 API key，演示价值最高 |
| 2026-09 | Playground Monaco **强制本地打包**（与设计稿"必要时 CDN"相反） | `@monaco-editor/react` 默认走 CDN，离线演示会白屏；离线安全优先 |
| 2026-09 | 不用 Monaco TS 语言服务，自写 monarch 高亮 | TDSL 不是 TS，TS 语言服务会报无意义的红色波浪线 |
| 2026-09 | 文档体系简化：10/20/30 三份设计合并为 `10_设计/设计总览.md`；删占位目录与 P0 历史切面 | 类型 SSoT 是 `packages/core/src/types.ts`，文档只留速览；P0 历史由教程 00-05 承载 |

## 3. 当前状态快照（2026-09，Spec 驱动对拍交付后）

- **221 单测全绿（P11 双语法 + FFI 首轮后）**：core 5 / parser 48 / typecheck 35 / codegen-java 34 / codegen-react 28 / llm 13 / playground 6 / cli 14 / server 22；九包 strict typecheck 通过。
- 演示入口：**`npm run server`（或根目录 start-server.sh，http://localhost:8787）**：浏览器提需求 → agent 写分片 → 编译自修 → 产物导出 zip → **run_app 起前后端（vite dev + mvn spring-boot:run + H2），用户反馈 → agent 读运行日志自修（M10 闭环）**；`npm run playground`（离线试验台）；端到端：`npm run slice`（单文件）+ `npm run slice:multi`（M7 对拍）；CLI：`npm run dsl -- check/build examples/todo-multi/tdsl`。
- **主线方向已校准（2026-09）**：一句话生成无法测出 DSL 表达力，改走 **Spec 驱动（SDD）**：结构化 Spec → TDSL → check-spec 自动对照（`npm run check-spec -w jxc`）。进销存（examples/jxc）为首个完整测试样例，暴露 7 项表达力缺口待排期（枚举 label/表单联动/where+aggregate 最痛）。网页（M9/M10）定位为外壳，暂缓。
- **下一步**（按当前优先级）：表达力缺口补齐（C1 where+aggregate 查询链 → G1 枚举 label → G2 表单联动）→ 评测基准 → M3/M5 视需求排期。

### 3.1 进度日志（按切面交付序，逐条追加）

| # | 日期 | 切面 | 交付物 | 提交 | 关键数 |
|---|------|------|--------|------|--------|
| 1 | 2026-09 | P0 五包闭环 | core/parser/typecheck/codegen-java/codegen-react + todo-app demo | （早期提交） | 26 单测，双端 build ✓ |
| 2 | 2026-09 | P1 CRUD | interface 语法/Controller/真实 CRUD fetch | （早期提交） | — |
| 3 | 2026-09 | P2 复杂逻辑 | 运算符/List 方法/where 单条件/@Transactional/Decimal 算术/主子表 UI | （早期提交） | 51 单测 |
| 4 | 2026-09 | M1 命名空间 | 分层符号表/限定名 ds.Entity/歧义报错 | （早期提交） | — |
| 5 | 2026-09 | M4 View 声明层 + M6 外部能力 + M2 查询语言 | page 声明/多页面路由/antd 映射；service+component；where 复合/链式/聚合 | （早期提交） | 120 单测 |
| 6 | 2026-09 | 文档体系 | Tour（06_项目Tour）+ AGENTS.md 重写 + D4 口径修正 | 17079b2 | — |
| 7 | 2026-09 | P2 Prompt Pack | packages/llm：示例矩阵/五层组装/诊断修复闭环/autoMatch | 3a7b519 | +13 单测 |
| 8 | 2026-09 | 文档简化 | 三份设计合并设计总览；删占位与 P0 历史；调研文件正名 | 17079b2 | docs 29→18 文件 |
| 9 | 2026-09 | P2 Playground | packages/playground：Monaco 本地打包/四面板/防抖编译 | f12e5ce + 13f8104 | +6 单测 |
| 10 | 2026-09 | 项目记忆 | memory.md（本文档） | 13f8104 | — |
| 11 | 2026-09 | M7 多文件工程 | parseProject 分片合并（NASL 式全局命名空间、零 import）；诊断带 file；按功能纵向切示例 todo-multi（5 分片对拍）；顺带修复 declareGlobal 同段重名漏报 + codegen app 名合法校验 | 4f05527 | +16 单测，155 全绿 |
| 12 | 2026-09 | M8 CLI | `dsl parse/check/generate/build`（bin 经 tsx ESM register 加载）；薄命令层（run(argv)→{code,stdout} 可测可复用）；app 名清洗；诊断人话化；端到端 build 验证 | 91adfcb | +14 单测，169 全绿 |
| 13 | 2026-09 | M9 在线 TDSL Agent | packages/server 嵌入 pi SDK（会话/工具循环/流式 WS）；TDSL 工具 ×4（compile_tdsl 裁判/读写分片/generate_code 落盘）；产物导出 zip（java/react/all）；GLM 端点 env 注入（含 compat 透传）；聊天页自动重连+错误回流；dev/23 设计文档 | eda7820 | +14 单测，server 独立交付 |
| 14 | 2026-09 | codegen 对拍修复 | agent 实际产出（合同管理 4 分片）暴露双端缺陷：react 8 处（hook 重复声明/input 接线/detail row 别名/Page<T>.content/onRow/结构体实参/.npmrc 锁公网）+ java 6 处（enum 类生成/裸枚举限定/查询链类型推断/X.all 链式/logic 间调用注入/orderBy 关键词）+ cli generate 混写 bug | 34481cd | 双端对拍 mvn+vite build ✓，186 全绿 |
| 15 | 2026-09 | 表单字段类型升级 | form 字段按结构体类型升级控件：枚举→Select（选项来自 TDSL enum）/日期→DatePicker/数字→InputNumber；agent 提示词规范表单绑定；.npmrc 机制之前已落地 | 0fef2d6 | +3 用例，188 全绿 |
| 16 | 2026-09 | M10 运行回路 | runner 进程编排（mvn spring-boot:run + vite dev + /api 代理，H2 内存库零安装）；run_app 编排工具（up/down/restart/status/logs）；错误回流（后端日志 grep + 前端 reporter → client.log）；GET 接口参数 required=false + defaultValue；/healthz 探针 + 端口参数化 | b4de90a | +8 用例，196 全绿；真机冒烟：healthz/业务接口 200、干净 down |
| 17 | 2026-09 | M10 实战调试周 | 连环真机调试与修复：①OpenCode Go 网关要求会话头（MissingSessionID）→ compat 强制 sendSessionAffinityHeaders；②agent 诊断日志（agentEventLogger→logs/agent.log）+ 浏览器 🐞 调试面板 + GLM 超时放宽 5min/重试 5；③会话持久化（.sessions 固定目录 + 恢复 + 恢复失败自动换新）；④思考状态可视化（🤔 计时器）；⑤上下文按需拉取（read 只给清单/诊断封顶 10 条/generate 目录聚合）；⑥运行面板手动启停按钮 | c73149d..1a5df38 共 6 commits | server 22，全仓 199 全绿 |
| 18 | 2026-09 | typecheck 端点暴露拦截 | agent 车辆租赁应用漏写 interface → api.ts 缺函数 → 前端白屏（反馈闭环首次真跑通：client-error 回流→定位→checker 补漏）；checkBinding 新增'绑定逻辑必须被 interface 端点暴露'；示例矩阵抓到 external-service 示例自身不合规并修复 | 83cf582 | typecheck 37，199 全绿 |
| 19 | 2026-09 | genForm 自产 Button import 缺失 | form 自动提交按钮不在 antd import 收集范围 → ReferenceError 白屏；collectFormAntd 强制计入（覆盖 repeat 明细块自产按钮）；顺手用修好的生成器重刷了用户沙箱产物 | 1a5df38 | 199 全绿 |
| 20 | 2026-09 | dialog 抽屉完整闭环实战 | 用户白屏三连修复：dialog import 相对路径（页面内 importer 应 ./X，原 ./pages/X 解析到 src/pages/pages/）→ Fragment 包裹兄弟 JSX → 沙箱孤儿 Java 主类（CLI 手动重刷不清旧产物致 mvn 双主类失败，generate_code 已根治，CLI 后续对齐）→ 后端 restart 后接口 200（H2 建表+数据在）| 84f5f3e 等 3 commits | 用户实测车辆租赁应用全链路跑通 |
| 21 | 2026-09 | Spec 驱动编译器对拍（进销存） | 主线回归编译器：examples/jxc = 结构化 Spec（spec.yaml 六层，SDD 路线对标 CodeWave）+ check-spec 覆盖度对照器（五维 287 项，exit 1 可进 CI）+ 全套 TDSL（13 实体/5 枚举/32 logic/15 页面/32 按钮）双端 build；实测修复 6 个 codegen 缺陷（F2 List\<struct\> import/F3 Decimal 比较 compareTo/F4 Integer 累加器 long/F5 api.ts body 重复/F6 DatePicker 类型/F8 enums import 无条件发射——#14 起 slice:multi 实际是坏的）；记录 7 项表达力缺口（C1 where+aggregate、G1 枚举 label、G2 表单联动等）| （本次） | 208 全绿，spec 覆盖率 100% |
| 22 | 2026-09 | P11 书写面 TS 词法化 | parser 双语法兼容（logic↔function、:=↔const(: T)、for-in↔for-of，AST 同构零改动）；jxc/todo/multi/llm 矩阵全量新语法；D4 口径修正 |
| 23 | 2026-09 | FFI：Java 一等公民（dev/27） | core/stdlib 目录模型（每方法 java/js 模板选填=单端/双端；String/BigDecimal/LocalDate/LocalDateTime/List 四域）+ typecheck 4.6 道（成员解析可解则解、未知放行 + 静态/实例错配/目录外成员附 bundle-jar 补录口径）；jar dump 通用机制/react js 模板翻译/d.ts 投影/jxc 标准库重写为余项 | （本次） | 221 全绿 |
| 24 | 2026-09 | G2-1 前端表达式域（dev/29） | typecheck 第 5 道（derive 纯函数声明/IO 禁令、carryBy 可达校验、min-max-pattern）+ codegen-react（derive 计算 readOnly、carryBy 拉档填回、属性拦截并入 reqCheck、页面级 required 覆盖）；dev/28 分层 roadmap（语言/代码生成/工具链/外壳） | 2cae02a | 226 全绿 |
| 25 | 2026-09 | FFI 收口打样（dev/27 B2/C1/C3） | cli 新增 bundle-jar（jar→类清单→javap 反射→目录 JSON，frontend:false 不对称）；jxc 全库挂标准库 trim() ×11（语义保留）；javap descriptor 解析质量为余项 | 97b99ed | 226 全绿，双端 build+spec 100% |
| 27 | 2026-09 | C4 评测报告（dev/31） | 结果一页纸成文：首轮 3/7 + 修复 5/7 + build 抽验、失败分类（parse 词法长尾 / FFI 精析余项 / 非确定性波动/OpenCode 网关会话头重现）；下一环以 selection join d.ts SDK 生成器取舍 | docs/31 | 226 全绿 |


## 2026-09-12 追加（A1 异常表达 / FFI 打样）
- A1 完成：前端表达式域定稿 = 纯函数（无变量/无语句/无 IO）；typecheck 兜底 throw 消息空间（标量面）。
- dev/27 FFI 首轮：core/stdlib 目录模型（String/BigDecimal/LocalDate/LocalDateTime/List 四域）+ typecheck 4.6 道（成员解析可解则解、未知放行）；jxc 打样（供应商带出/明细金额派生）。
- 余项：round-trip 演练（bundle-jar 命令/d.ts 投影）为后续切面；程序员可点可验（真机冒烟）。

## 2026-09-13 会话追加（fastjson2 真实 jar 打样 + roadmap 精算）
- **FFI 真机打样完成**：`D:/fastjson2-2.0.58.jar` → `bundle-jar` 反射 527 类 → 人工精选 3 类（JSON/JSONObject + maven 坐标）进 core 目录 → TDSL 直调 `JSON.toJSONString/parseObject` → **codegen pom 自动注入 fastjson2 依赖坐标** → 双端 build ✓。这是 FFI 的完整故事线第一次真实跑通。
- 顺手修：无实体 app 的 Controller 空包 import（F8 同款边界）、纯 FFI API app（有 views 无 entities）的 react 骨架缺失、目录扫描把 FQN 混进依赖坐标的 bug。
- 存量余项：javap descriptor 精析（当前手收窄）、npm/d.ts 前端口径、重载去重。
- 下一环推荐序：**C4 评测基线（jxc 样卷已齐 → 第一份 LLM 生成质量数据）→ C1 小补丁 → A3 selection → B3 SDK .d.ts（收官键）**。
- 用户意图校准：语言完备度的验收姿势变了——**从"我们手写全覆盖"转向"LLM 生成 + 编译器裁判 + spec 对拍"的自动化验证链**；评测跑完后，剩余任务的推进方式都按"go 循环"走（LLM 干活、人 Gate）。剩余主线人力估 1~2 天。

## 2026-09-13 会话追加（dev/32 依赖声明与目录外置）
- **架构纠偏（用户提出）**：第三方 jar 扫描清单硬编码在 core/stdlib.ts 是入侵语言核心——fastjson2 两条从 FFI_CATALOG 移出，core 只留语言自有五域（String/Decimal/Date/DateTime/List，属语义核类型定义）。
- **两件套落地**：①`dependency java "g:a:v" [as ns]` / `dependency npm "pkg@range"` 顶层声明进 AST（AppNode.dependencies）；②bundle-jar 产物升级带头对象 `{eco, coordinate, classes}`（坐标自动取 jar 内 pom.properties，--coord 可覆盖），落工程 libs/，check/generate 经 opts.libs 装载、createCatalog 坐标匹配合并。
- **同名类消解（用户补位设计）**：fastjson/fastjson2/jackson 都有 JSON → alias 全局唯一不变式 + D-dep-4 撞车诊断；消解二选一：产物改 alias（首选）或 `dependency ... as ns` 限定引用（对标 M1 ds.Entity）。
- pom 依赖注入从"目录 maven 字段反推"改为声明驱动；react package.json 并入 dependency npm 声明（声明版本覆盖 component 默认 `*`）。
- 交付：261 单测全绿（+28）、fastjson-demo 迁移真机双端 build ✓、jxc spec 100% 不回归。
- 余项：ffiCheckExpr 不递归 Binary（存量宽松）→ 包在比较里的第三方调用不触发 D-dep-1；ns 限定未声明依赖宽松放行（避免 ds.Entity/enum 误报）；npm d.ts 投影仅留字段位（B3）。

## 2026-09-13 会话追加（教程改版）
- `docs/70_教程` 重组：P0 时代教程（00-05 + 06 Tour）原样归档 `v1/`（README 顶部加归档横幅）；新写当前版教程 12 篇（00 总览十包流水线 / 01-05 逐包设计 / 06 工具链总索引 / 07 cli / 08 llm / 09 server / 10 eval 独立成篇），风格对齐 v1（编号+表格+源码导读+动手练习），数据以 261 单测实测为准；抽查修正 throw 翻译事实（TdslError 非 IllegalStateException）。AGENTS/设计总览/index.html 引用同步。
- **新增 20_语法手册**（面向书写者的人+LLM 语言参考）：六章（顶层声明/逻辑/查询/接口/页面/第三方接入），片段来自 examples+单测并**过编译验证**（临时单测实测，enum label 语法实测修正为 `KEY('中文')`）；定位为 cheatsheet 的语义权威来源；README 加"想直接写 TDSL 跳过 00-10"入口。
- **TS 化收尾（用户拍板"不要双语法"）**：TS 面为唯一书写口径，legacy（logic/:=/for-in）降级为"废弃仅存量兼容"。清理：8 个测试文件 ~180 处 legacy 写法全改 TS 面（sed 批量+同构测试改写为兼容性测试）；cheatsheet 禁止事项补三条；手册/00/02 教程/设计总览 D4 口径同步改写。261 单测全绿、slice/slice:multi/check-spec 100%。
- **parser 物理删除 legacy（用户拍板"没必要兼容老项目"）**：parser.ts 三处 legacy 分支删除（`logic` 关键词/`:=` VarDecl/`for-in`）——`logic` 报 unexpected、`:=`/`for-in` 报"已废弃"口径（报错即文档）、`for` 缺 `const` 报人话提示；lexer 的 `:=` token 保留（分词报错需要）。兼容性单测改写为 5 条废弃报错断言 + TS 面解析断言。文档"仅存量兼容"口径全量改为"已物理删除"。265 单测全绿（+4）。
- **dev/33 外部能力一等公民化（用户批评"封装层违背一等公民承诺"）**：①删 `service kind='bean'`——本地 jar 类与 FFI 直调重叠，dependency java + libs 产物是唯一通道；②删 `component` 注册层——npm 一等公民对标 java 侧，页面直接写三方组件标签，import 包名由 `dependency npm` 声明解析（`as ns` 显式命名优先 + 包名尾段 norm 兜底），未声明报 D-dep 口径；③dubbo/http 保留重定位为"外部系统对接"（运行中 RPC/REST 契约，非依赖封装）。设计文档 dev/33。265 单测全绿、slice/slice:multi/check-spec 100%。
- **dev/34 依赖声明统一 import 形态（用户三轮收敛语法）**：`dependency xxx "坐标" [as ns] [import X | import { A, B as C }]`——`as ns` 回归 jar 级命名空间本义（撞名消解，可选）；`import` 与 JS 语义字面一致（npm 默认/具名导出，java 产物类显式进裸名 + 列表内 `B as C` 改名）；无 import 的 java 声明保持产物全量进裸名（兼容）。三方组件匹配改按 imports 列表（显式导入后不再尾段兜底）。codegen-react 具名导出同包聚合生成。272 单测全绿、全链路回归 ✓。
- **新建 72_教材（面向本科生的教科书式教程）**：用户两次否掉浅大纲（"太片面没有深度"→"只包括编译器部分，外围的 cli/llm 不要；java/npm 一等公民这个设计要好好写；不要动手练习"）。最终 11 章 + 附录：1 导论 → 2 AST 设计 → 3 词法 → 4-5 语法（含查询语言/JSX/linkApp）→ 6 类型检查 → 7 符号表 → 8 codegen 原理 → 9 Java codegen → 10 React codegen → 11 FFI 专题（最深章，占教材四分之一）。风格：先理论（正则/CFG/类型论）→ 设计决策 → 源码映射推导"为什么代码长这样"。索引已同步 docs/index.html。
- **03-15 会话（72_教材修订 + dev/35 第一优先清单）**：用户逐节对拍教材与源码，发现并修正 4 处教材-代码漂移（ch05 parseCallArgs 按真实内联实现重写——括号归 parsePostfix/方向存 String 节点/isQueryChain 无 aggregate；§5.4 parseViewElement §5.5 dependency 核对一致；§5.6 parseAnnotations 系虚构改写为就地解析机制；ch06 check 签名/函数体按真实内联流程重写）。**dev/35 新建（第一优先）**：LLM 优先商用就绪清单——北极星"意图拦不了其他都能拦"，P0=诊断结构化(code/suggestion/根因裁剪,1-2周)+表达式层类型核对(无推导简单核对,1-2人月,五类漏拦点:赋值传参/互调arity/成员访问/return核对/nullable)+修复闭环策略化；P1=运行前验证(第二道裁判,编译绿≠通过)/API面闭包防幻觉/业务表达力(try-join-G2)/本地src依赖形态；P2=编译延迟/eval运行维度/安全审计/服务化。**明确不做（用户拍板 LLM 消费形态）**：LSP/round-trip/迁移器/外围工具投入；用户代码走 jar/npm 外部依赖路线 A（src 目录扫描形态待做），绝不开放生成工程内部文件编辑。索引已同步。

## 2026-09-15 会话追加（dev/35 修订）
- 用户对 dev/35 拍板两条：①增量编译明确不做（P2-1 收窄为耗时基线测量，先量再议）；②P1-1 运行前验证（冒烟+Spec 对拍）定性为 harness 侧职责（packages/eval + server runner 编排层），不占编译器投入——编译器只承担"面向归因的诊断接口"。文档 P1-1/推论/执行顺序/QA/索引同步改。
- 追问确认：P1-3（try/throw、join/事务、G2 表达式域，language 面全链路）与 P1-4（src 目录依赖，core 依赖模型+CLI 扫描+D-dep+生成装载）均属编译器/工具链侧；dev/35 新增 §1.1 责任归属分界表（编译器 vs harness，判据：动语法/检查规则/代码生成/依赖模型=编译器，只跑与对拍=harness）。
- 终版拍板：harness 侧整体暂缓（运行前验证、eval 扩容都移出，只留编译器侧诊断接口可归因的余量）；dev/35 全文精简重写为纯编译器路线（P0 三项/P1 三项/P2 三项 + 不做清单 + 一句话顺序），去掉归属分界表；编号重排。
- 终版（第四次）："跟 PPT 一样"——dev/35 精简为两栏：编译器相关（P0 三项/P1 三项/P2 三项，每项一两行）+ harness 暂时不做（留诊断接口可归因余量）+ 不做清单一行。 rationale/估时/章节论述全删，QA 记录保留三次修订轨迹。
- 用户纠偏：编译器必须全量报错（人类/IDE 也消费），"一轮一个"是错的——定调"都给，然后分层"：编译器=全量+依赖序排序+级联分组；修牌挑选（一轮一类/token 截断）属 packages/llm 调用方策略，非编译器职责。dev/35 P0 第一项改为"诊断全量结构化"，第三项标注 llm 侧。
- 第五次收敛：P2 整体不做（延迟基线/安全审计/服务化进不做栏）；业务表达力升入 P0（编译器主战场第一位级）；API 面闭包目录导出与 src 目录依赖形态暂缓。终版 P0 四项：①诊断全量结构化②表达式类型核对③业务表达力④修复出牌策略（llm 侧）。
- 第六次：出牌策略彻底逐出编译器清单——定调"我们只要把报错分类，LLM 怎么拿怎么修是他的事"（P0-1 的 code/依赖序排序/级联分组已覆盖）。dev/35 收敛为 P0 三项：诊断全量结构化、表达式层类型核对、业务表达力。

## 2026-09-16 会话追加（芋道 ERP/CRM 能力验证 · dev/39-40 编码）
- 靶系统：ruoyi-vue-pro 芋道 ERP/CRM 子集打样（dev/39：46 实体/13 枚举/6 模块/product-stock-purchase-sale-finance-crm/79 页面/201 按钮，六层 spec.yaml）。
- examples/yudao = 对照工程：spec.yaml（46 实体）+ check-spec.ts（从 jxc 拷贝，ROOT 解析）+ 7 分片 tdsl（00-model/10-product/20-stock/30-purchase/40-sale/50-finance/60-crm）+ 根 workspaces 挂接。
- **实测结果（首轮一次通过，仅 3 处自修）**：check-spec 五维 1089 项缺口 0 覆盖率 100%；`dsl check` typecheck 0 问题（仅忠告类 NULLABLE-HINT warning，与 jxc 同款「局部遮蔽 X.get」写法）；codegen 双端成功 java 285 文件 + react 89 文件。
- 自修 3 处：PurchaseInItemInput/PurchaseReturnItemInput 补 orderItemId 字段（链式写要从 input 拿 orderItemId）；changeCrmBusinessStage 补 interface 端点暴露（checkBinding 规则）。
- 验证结论：单一 M4 语法面覆盖真实企业 100% 页面结构零缺口 → 语言生成力验证通过；唯一页面文字级 mismatch 仅 a标签 前缀（"通过"按钮含业务态说明文字，TDSL 按钮 text 精确匹配）。
- 语义简化项（进 dev/40 缺口清单）：DateTime 无 now、除法运算 OK、dialog 内 submit 按钮在结构层可过、changeCrmBusinessStage 业务主键传递为结构占位。

## 2026-09-15 会话追加（P0 编码落地 · dev/36-38）
- 用户 "do" 启动，六阶段全走完（四道 Gate 全部一次通过）。落地内容：
  1) Diagnostic + code/suggestion/root（48 处 push 收口，message 文案零改动），新增 DIAG_LAYERS{TYPE=1,API=2,DEP=3} + diagLayerOf
  2) check() 尾部稳定排序（error→warning→layer，层内声明序）；**ok 语义改为"无 error 即过"**（warning 不阻断，与 ch06 口径一致，NULLABLE-HINT warning 落地）
  3) 新文件 scope.ts（VarScope{type,mayNull,source}，contribute/contributeForOf）+ expr-type.ts（exprType 判定核/queryResultType 链：X.all|where→List<X>，.limit/.orderBy 保型，.page→Page<T>；assignable 名义等价+Integer→Decimal 单向+Object 通放+泛型递归）+ check-expressions.ts（五核对点：VarDecl 声明初值/Assign/logic 互调 arity+参数型/Member 存在性/Return 核对/NULLABLE-HINT warning；不下钻 Call callee 避重；判不出一律放行）
  4) llm/repair 三段式出牌：摘要行（共 N 个问题；当前层）+ 首层≤3 条带 [code]/humanize/（改成: …）+ 暂缓尾注 + 4000 字符截断 + repairLoopPlan 轮间 diff（上轮→本轮）
- 新增测试 18：typecheck/p0.test.ts(15) + llm/p0.test.ts(3)；存量样本修正 1 处（typecheck.test.ts 静态调静态 member 成功例：y.getYear()←String 错配改为 y:Date=Date.now()+n:Integer=y.getYear()，属 F3 正确性收紧）
- 回归：290 单测全绿（272→290）、typecheck 九包 ✓、slice/slice:multi 双端 build ✓、todo/todo-multi/jxc check 0 问题
- 教训：closure 内 narrowing 失效（forEach 的 recv 需先提变量）；Diagnostic 住在 typecheck 不在 core（dev/38 笔误已 QA 记录）；kernel Date.now() ret 'Date' 而非 DateTime

## 2026-09-16 会话追加（M10 @ref 全量补齐 + yudao 灌数 + 生成器清目录根治）
- **@ref 审计结论**：yudao 原仅 9 处字典类 @ref；最大缺口 = 人员字段裸 Integer（无 User 表）→ 新增 `SystemUser` 实体(id/username/nickname)+UserInput，ownerUserId×7/saleUserId×3/financeUserId×2/signUserId 全挂 `@ref(SystemUser, display:'nickname')`；其余 ~45 个业务外键（产品/分类/单位/仓库/供应商/客户/结算账户/商机/状态/合同等）全部显式 @ref（显式优先、推断兜底口径落地）。例外口径：planId 撤回（CrmReceivablePlan 无 String 显示字段）、子表归属 id（inId/orderItemId/bizId/关联表）不挂。
- 词典/人员 CRUD 补齐：source/industry/area 三个写字典 save 逻辑 + POST 端点（原只有 GET，seed 全 404）；`querySystemUser`/`saveSystemUser` + GET/POST /api/users。
- **头部渲染 verify**：线索列表负责人列不再裸数字（qFkOwnerUserId → nickname）。
- **codegen-react 六连修（import 收集与渲染精确对齐一战）**：collectAntdComponents 排除 form 内 input；collectFormAntd 逐字段镜像 genForm（derive/字符串→Input、fk/enum→Select、数值→InputNumber、Boolean→Switch、日期→DatePicker）；一刀切 Page 级 Select 收集取消（表格列 fk 不产生 Select）；_repeat 明细 render 未用 row → `_row`（noUnusedParameters）；重复生成孤儿文件根治（见下一条）；detail 页 row 上下文 = 首 List 查询首行 / dialog 内 row = initial；repeat 明细 useState 默认对象按**完整结构体**给值（对话框未声明字段缺值致 TS2741）、**枚举单元格** Select+as cast 取代 Number 赋值（TS2322）。
- **CLI generate 清目录根治（用户发飙后）**：孤儿主类问题第三次出现；writeAll 先清本批路径管理的顶层子树（无扩展名顶层段）+ java/ 整目录重建（生成器全权所有，target 陈旧 class 一并消失）+ rmTree 带 maxRetries/retryDelay（Windows 句柄延迟释放 EPERM 兜底）；+1 单测锁孤儿不残留。口号：**生成前先清输出目录**。
- **yudao 混包教训**：CLI app 名取目录名 → `examples/yudao/tdsl` 生成进 com.tdsl、旧手产物 com.yudao 并存，双主类 EPERM 连环；正解 `--name yudao` + 清空重刷。
- **验证链**：yudao 双端 build ✓（java mvn compile、react tsc+vite build 全绿）；seed.ts 灌数 **105/105 0 失败**（users→字典→产品/仓库/供应商/账户→库存→采购/销售/财务→CRM 全链）；全仓 302 单测全绿（+2：cli 孤儿清理 ×1、react 补齐后口径）。
- 余项：yudao 详情页查询不带 id 过滤（queryXxx 无 id 参数，spec 简化遗留）；react vite 警告 chunk>500KB（非阻断）。

### 2026-09-16 续（@ref 前端交互三连修 · 用户实测驱动）
- **搜索条 @ref/enum 渲染**：产品列表"启用状态"这类搜索条件原来还是纯文本 Input（用户点名）→ 新增 `collectSearchEnumFields`/`collectSearchFkFields` + `searchEnumSelect`/`searchFkSelect`：搜索条 FK 字段走引用下拉（复用 `qFkXxx` hook，不额外请求）、枚举字段走选项下拉（label 取自 `KEY('中文')`）；antd import 收集同步排除被升级字段的 Input。
- **错误可见化（用户点名"接口报错前端没反应"）**：① api.ts 生成的 fetch 统一 `r.ok` 校验，非 2xx 抛错 → 错误体不再灌进 Table 导致 `rawData.some is not a function` 白屏；② hooks.ts useQuery/useMutation 的 catch 加 `message.error(...)` 弹窗提示；③ 数值搜索参数空串/NaN → `undefined`（防 `?customerId=NaN` 打后端 500）。
- **枚举查询 SQL 报错根治（Hibernate 参数绑定）**：现象 `status=DISABLE` → `SQLGrammarException`/`Values of types "CHARACTER VARYING(255)" and "BINARY VARYING(255)" are not comparable`。根因：Spring Data JPA **位置参数** `?n` 在 `?n IS NULL OR c.x = ?n` 结构里 Hibernate 推断不出枚举类型，退化为 Serializable(varbinary)。**否决了两个错方向**：用户明拒"内存过滤"；也没换 MyBatis（大动作不必要）。
  - 修法（生成器级）：repository 生成由 `?n` 改 **named 参数 `:field` + `@Param("field")`**（Hibernate 解析期可从 `c.x = :field` 反推列类型）；枚举存储 `@Enumerated(EnumType.STRING)`（varchar，库内可读）；去掉试错用的 COALESCE 特判。
  - 实证（真机 + 105 条数据）：`status=ENABLE`=7、`DISABLE`=[]、不带状态=7（null 宽松）、`name=联想&status=ENABLE` 命中、`purchase-orders?status=AUDITED/UNAUDIT` 正确分组 2/1、`categoryId+status` 组合 2。
  - 教训沉淀：**JPA 枚举/参数查询一律 named 参数**；`?n IS NULL OR` 位置参数 + 枚举是 Hibernate 5 的坑。
- 回归：302 单测全绿、九包 typecheck ✓、yudao 双端 build ✓、真机筛选全对。

### 2026-09-16 续二（详情页语义纠正 + 行内按钮样式 · 用户实测驱动）
- **详情页错写成"列表页"（用户点名）**：yudao 14 个 `*Detail` 页原来声明为 `<table>`+顶部按钮，跳进来看到的是整张列表、`row` 被绑成首行、编辑不生效。
  - TDSL 正确写法（对齐 todo-multi 范式）：`@export function getXxx(id: Integer): Entity { return Entity.get(id); }` + `GET '/api/.../{id}'` 端点 + `<detail dataSource={useQuery('getXxx', $route.id)}><text field=".." title="中文"/></detail>`，按钮保留在页面级。
  - 覆盖：Product / PurchaseOrder·In·Return·Payment / SaleOrder·Out·Return·Receipt / CrmClue·Customer·Business·Contract·Receivable 共 14 页（+14 getter、+14 端点，java 309→323 文件）。
- **codegen-react 配套修**：① `rowSrc` 检测扩展——无 table 且 useQuery 实参引用 `$route.id` 时，也把主查询结果绑成 `row`（详情页编辑/动作按钮需要；此前只在参数引用 `row` 时绑定）；② `genDetail` 支持 `title` 属性作 Descriptions 中文标签（此前只输出 field 名）。
- **行内按钮样式（用户："行上按钮不要用实心按钮，丑"）**：`genButton` 行内（table 操作列）改用 antd 链接式 `type="link" size="small"`（删除保留 danger），页面级按钮仍 `primary`。
- 回归：302 单测全绿、yudao `dsl check` 0 问题、check-spec **1091 项 100%**、java mvn compile ✓、react tsc+vite build ✓、真机：`/api/erp/products/1`、`/api/crm/clues/1`、`/api/erp/purchase-orders/1` 均按 id 返回单条；seed 105/0。

### 2026-09-16 续三（抽屉化详情 + 标题按模式 + 删除二次确认 · 用户实测驱动）
- **详情改成右侧抽屉（用户点名）**：14 个 `*Detail` 由 route 页面改 `dialog`（不进路由/菜单），`<detail dataSource={useQuery('getXxx', initial.id)}>` 按选中行查单条；列表行「详情」按钮 `navigate`→`openDialog(xxxDetail, row)`。getter/端点保留复用。
- **抽屉标题按模式（用户点名"新增也显示编辑"）**：`@title('产品编辑')` → `<Drawer title={initial ? '产品编辑' : '产品新增'}>`；含 `<detail>` 块或标题以「详情」结尾 → 固定「产品详情」；无后缀标题（如「商机阶段变更」）保持静态（不硬凑后缀）。
- **删除二次确认（用户点名）**：`genButton` 删除类动作（text 含「删」）包 `Popconfirm`（okButtonProps danger + 行内 stopPropagation 防触发行跳转）；import 收集同步（含删除按钮的页面加 Popconfirm）。
- **codegen-react 支撑改动**：① dialog 子组件改**条件挂载** `{showX && (<X .../>)}`——否则抽屉未打开时 `initial.id` 查询会以 0 触发 404 + 错误弹窗；② `rowSrc` 支持 `initial.id`（抽屉按行查单条 → `row` = 查询结果）；③ `genBindingArg` 支持 `initial.id` → `Number(initial?.id ?? 0)`；④ 已有 rowSrc 时不再重复声明 dialog 的 `row` 别名（避免重复声明）。
- **spec/对拍同步**：spec.yaml 14 行内「详情」按钮 navigate→openDialog；check-spec `kind: detail` 期望由 `page` 改为 `dialog`（详情即抽屉，与编辑/新建同形）。
- 回归：302 单测全绿、九包 typecheck ✓、check-spec **1091 项 100%**、java mvn compile ✓、react tsc+vite build ✓、真机 seed 105/0。

### 2026-09-16 续四（dev/43-45：动作状态化 + 业务链联动 + 列表/抽屉统一交互 · 六阶段交付）
- **用户定调**："yudao 像个 CRUD 架子"——逻辑在但呈现/联动断裂。切面走完整六阶段（需求 dev/43 → 系统设计 dev/44 → 详细设计 dev/45 → 编码 → 测试 → 交付），四道 Gate 全通过。
- **语言面新增（零新增 AST 节点，全挂既有属性；parser 零改动）**：
  - `visible={row.status === DocStatus.UNAUDIT}` / `disabled={...}`：按钮条件渲染/置灰；条件为行上下文受限子集（字段比较 + 枚举成员 + 逻辑组合）；枚举成员在 codegen 侧**字面量化**为 `'UNAUDIT'`（`enumMemberLiteralOf`，derive 同步受益）。
  - `<summary field="items" of="count"|expr={count * productPrice} label="合计"/>`：表单明细实时归约（`summaryExprToJs`，Ident→`it.x`）。
  - `<detail>` 内 `<repeat field><column/></repeat>`：详情只读子表（抽 `columnDefsOf` 与列表列共用枚举 Tag/外键名三态）。
  - typecheck：KNOWN_VIEW_TYPES += summary；`SUMMARY-TARGET` / `SUMMARY-EXPR`（结构性可判 → error）。
- **业务链联动（yudao，纯 logic）**：`applyStock(productId, warehouseId, delta, bizType, bizId, bizNo)` 共享入口（库存±、不足抛「库存不足」、写 StockRecord 含结存快照）；8 个审批/反审批接线（入库/退货/出库/退货 → 库存+流水、订单 inCount/outCount 回写与状态推进；付款/收款 → 按 bizNo 核销回写 paymentPrice/receiptPrice）。
- **详情聚合**：`PurchaseInDetail { in, items }` / `SaleOutDetail { out, items }` + `GET .../{id}/detail`；抽屉按 `initial.id` 查单条（rowSrc 支持 initial；genBindingArg 处理 `initial.id` → `Number(initial?.id ?? 0)`）。
- **用户实测追加的 UI 统一**：①右上角动作区（列表卡片标题右侧 / 抽屉 extra，含表单「保存」用 form 属性关联、页脚不再重复；动作 >3 折叠「更多」）②标题分隔线 borderBottom ③详情抽屉化（*Detail 改 dialog + 列表「详情」→ openDialog）④抽屉标题按模式（新增/编辑/详情，靠 initial）⑤行内按钮链接式 type=link size=small ⑥删除按钮 Popconfirm 二次确认。
- **实测（阶段五）**：A1-A6 全过——库存 120→140、PURCHASE_IN 流水、订单 inCount=70=totalCount 自动 AUDITED、库存不足回滚且库存不变、详情 {in, items[2]}、核销 93261/48920；seed 104/0。
- **用户报缺陷（真机）**：①列表无分页（genTable 硬编码 pagination=false）→ 改客户端分页（10/20/50 + 总数）②**翻页后条数虚增（第一页显示 14 条）根因 = rowKey 取首列字段**（库存变动明细首列 productId 重复 → React key 冲突残留旧行）→ rowKey 改实体主键。教训：**表格 rowKey 必须唯一，宁可取实体主键也不取首列**。
- 交付：310 单测全绿（codegen-react +5 action-state、typecheck +3 summary）、九包 typecheck ✓、yudao dsl check 0 / spec 1091 项 100% / java compile ✓ / react tsc+build ✓；文档 dev/43-45 + 语法手册 §4 + index.html + QA 19-25 行 + 本段。
- **交付形态适配记录**：本项目是"编译器+生成器"无常驻 REST 服务，skill 模板的 `docs/api/接口文档 + Postman 集合`降级为**语言面文档（语法手册）+ interface 契约（生成物 Controller 即 REST 端点）**；如需 OpenAPI 可另立切面从生成物导出。

## 2026-09-16 续五（dev/46-48：ERP 门户看板 · 六阶段交付 + 用户实测三轮收敛）
- **切面**：给 yudao 补门户层（统计 + 轮播 + 列表 + 进度），六阶段走完（dev/46 需求 → 47 系统设计 → 48 详细设计 → 编码 → 测试 → 交付），Gate 全通过。
- **C1 缺口补齐（连带必做）**：`Order.where(...).aggregate(count())` 此前不支持（dev/21 历史缺口）→ QuerySpec 结构本就容纳 conditions+aggregate，改动收敛为：codegen-java 聚合分支拼 WHERE（named 参数 + null 宽松）、typecheck `CHAIN_METHODS += aggregate`（仅允许紧跟 where）、aggregate 方法名集中命名（无字段 → `countAll`，避开 JpaRepository 内置 `count()` 撞名）、react 零改动（标量 number）。
- **语言/生成器新增**：门户组件 `row/col(span)`、`carousel(autoplay)+item`、`list+item(primary/extra)`、`progress(percent,color,status)`、`alert(type,message)`；`statistic` 支持 `dataSource` 绑聚合查询 + `color`/`suffix`。全部挂在既有通用元素/属性上（零新增 AST 节点）。
- **样式（用户三轮反馈）**：指标卡 = 左色条 + 渐变底 + 26px 彩色数字；轮播 = 渐变 Banner（160px 白字 + 装饰圆）；列表 = Card + `List.Item.Meta`（主标题/次要行/右侧强调值）+ 每页 5 条分页；栅格 `gutter=[16,16]` + Col 纵向 flex + 卡 flex:1 等高对齐。
- **实测缺陷修复**：①列表枚举显示裸名（`UNFOLLOWED`）→ `listItemValueJsx` 命中枚举渲染中文 Tag；②文案含 `<`（"目标 <5%"）截断 JSX → 新增 `jsxText()` 转义 `< > { } &` 并应用到 title/label/提示等文案位；③门户菜单排最后 → 门户文件改 `05-portal.tdsl`（菜单按声明序）+ 首页动态为第一个列表页。
- **角色视角去掉（用户拍板）**：`@role` 语法解析保留（语言面），但外壳不再生成角色表/过滤/切换器；yudao 门户去掉 `@role`，全员可见。
- **排查记录**：门户接口首轮 404 —— 根因是**运行中的后端未重启**（java 已重新生成但进程是旧的）；重启后 16 个 `/api/portal/stats/*` 全部 200（purchase-orders 3 / in-pending 1 / return-pending 1 / purchase-amount 395730 / stock-count 4700 / sale-amount 147425 / sale-out-pending 1 / receipt 48920 / product 7 / warehouse 2 / clues 2 / customers 4 / locked 0 / business 2 / contract 1 / receivable-pending 0）。**教训：generate 之后必须重启后端**。
- 交付：全仓 318 单测全绿、九包 typecheck ✓、check-spec 1091 项 100%、java mvn compile ✓、react tsc+vite build ✓、seed 104/0。

## 2026-09-16 续六（操作反馈全局化 + 分层纠偏 + CRM 公海语义）
- **用户报缺陷**："很多按钮（领取、待办完成…）点了没任何提示，用户不知道干了啥" → 全局修：`useMutation` 成功后 `message.success(okMessage)`（此前只有失败提示与静默 refetch）。
- **分层纠偏（用户批评）**：我第一版把业务前缀表（`topool → 已放入公海`）写进 codegen-react——用户指出"业务文案不能写进生成器"。改为**DSL 声明、生成器搬运**：新增 logic 注解 `@ok('已领取')`（parser 捕获进 `logic.annotations`；顶层注解分支补 `skipParen` 防未知带参注解报错），codegen 取注解，未声明 → 通用「操作成功」；yudao 样例按动作批量标注 98 处（业务数据留在样本里）。
- **内核静态调用修复**：`DateTime.now()` 生成 `DateTime.now()`（Java 无此类）→ 在 codegen-java 接入共享内核目录 `FFI_CORE` 解析静态成员模板；同时修正 core/stdlib：`DateTime.now()` → `java.time.ZonedDateTime.now()`（与 javaType 的 DateTime→ZonedDateTime 对齐，原为 LocalDateTime 会类型不匹配）。
- **CRM 公海语义修正（用户问"领取后效果是啥"）**：原 `takeCrmCustomerFromPool` 硬编码 ownerUserId=1 且无校验，seed 客户本就 owner=1 → 点了等于没点；`assignCrmCustomer` 还有 `ownerTime = ownerTime` 自赋值 stub。修：放入公海（校验已在公海/锁定、清 owner+ownerTime、重置 dealStatus）、领取（校验必须在公海且未锁定、写 owner=1+ownerTime=now）、锁定（公海不可锁）、分配（锁定不可分配）；页面按钮按状态显隐/置灰（领取/放入公海互斥、锁定↔解锁互斥、锁定后编辑置灰）；seed 造三态客户（正常/公海×2/锁定）。
- **空外键占位**：外键列/列表项值为 0 → 显示 `-`（公海客户负责人不再显示 0）。
- 真机实证：领取 id=3 → owner=1 + ownerTime 时间戳；重复领取/锁定客户领取/重复放入公海/公海锁定 均返回业务错误文案；待办完成 → completed=1。全仓 321 单测全绿、java `mvn clean compile` ✓、react tsc+build ✓、seed 105/0。

## 2026-09-16 续七（外壳布局：顶部模块导航 + 左侧当前模块菜单）
- **用户要求**："模块放在顶部，左侧只展示某个模块的菜单" → 重写 `routerFile` 外壳：顶部 Header 放**模块横向菜单**（`@menu` 分组值即模块），左侧 Sider 只渲染**当前模块**的页面；`PAGE_MODULE` 由路由反查当前模块，点模块跳该模块首页。
- 无 `@menu` 的页面归入「其他」模块；若全无分组则以应用名作模块名（jxc/todo 等简单应用观感自然）。
- 顺带清掉 routes 里残留的 `@role` 守卫代码（此前已决定角色不驱动外壳）。
- 测试同步：折叠菜单用例改为断言 `MODULES/PAGE_MODULE`（顶部横向 + 左侧当前模块），断言不含旧 `group-`/`defaultOpenKeys`。全仓 321 单测全绿、react tsc+build ✓。

## 2026-09-16 续八（详情抽屉运行期崩溃 + 「更多」折叠漏 visible）
- **用户报崩溃**：采购入库详情报 `Cannot read properties of undefined (reading 'status')`（erpPurchaseInDetail.tsx:21）。根因：详情抽屉的聚合结构体 `row.in` 在查询返回前是 undefined，而条件表达式生成 `row.in.status`。修：`exprToJs` 的 Member 分支对**嵌套路径**（obj 也是 Member/Call）改用可选链 → `row.in?.status`（单层 `row.status` 不变，避免大面积改测试）。
- **用户报漏显**：列表上已审批的行「更多」里仍能看到「审批」。根因：行按钮 >4 会折叠进 Dropdown，而折叠项的 `items`/handlers 是**静态生成、未带 visible 条件**。修：折叠项改为运行期过滤——`const folds = [{key,label,show:(条件)}]; const shown = folds.filter(f=>f.show);` 全部不可见时不渲染「更多」；抽 `visibleCondOf()` 给 genButton 与折叠项共用。
- 回归：321 单测 / react tsc+build ✓ / vite 200。

## 2026-09-16 续九（详情→编辑预填明细丢失 + antd rowKey 废弃告警）
- **用户报**："采购入库详情有明细，编辑时明细没了"，控制台 antd 告警 `rowKey` 函数式（带 index）已废弃。
- **根因1（明细丢失）**：详情聚合结构体是 `{ in: PurchaseIn; items }`，编辑按钮把 `row.in` 传给表单 → 表单只认顶层字段与 `initial.items`（`in` 包了一层、且 `items` 不在 `in` 上）→ 明细与部分字段丢失。
  修：**详情 DTO 扁平化**——`PurchaseInDetail`/`SaleOutDetail` 改为主表字段（id/no/status/…）+ `items` 平铺；getter 逐字段拷贝；详情页 `<text field="no">`、按钮用 `row.status`/`row.id`；编辑按钮直接传 `row` → 表头字段与明细行都能预填（真机验证 `/detail` 返回扁平 DTO + items）。
- **根因2（告警）**：表单明细表用 `rowKey={(_, index) => String(index)}`（antd 已废弃）。修：`dataSource={items.map((it, i) => ({ ...it, key: String(i) }))}` + `rowKey="key"`（行对象多出渲染用 key，不进提交体）。
- 回归：321 单测 / java clean compile / react tsc+build / seed 105-0。

## 2026-09-16 续十（表单明细数据源：列表直接编辑也能带出明细）
- **用户报**：详情→编辑有明细；**列表直接点编辑没有明细**。根因：列表行是实体（`PurchaseIn`，无 `items`），详情行是扁平 DTO（有 `items`），表单预填只认 `initial.items`；DTO 扁平化只解决了详情入口。
- **新增能力（语言面既有绑定，零新语法）**：`<repeat field="items" dataSource={useQuery('getErpPurchaseInDetail', initial.id)}>` —— 明细行独立取数：
  - codegen：manifest 的 sync effect 里明细来源优先级 `查询结果?.items ?? initial?.items ?? 默认空行`，并把数据源加入 `useEffect` 依赖（取数回来后重填）；
  - 抽屉按 id 取数的查询加守卫 `initial?.id ? api.getX(...) : Promise.resolve(null)`（新增态不发请求，避免 `/0` 404 + 错误弹窗）；
  - `row` 别名与对应类型 import 仅在「页面确实引用 row」时生成（否则 TS6133/TS6196）。
- 修过程中发现的三个生成器问题：①`as X[] | undefined ?? y` 优先级（TS2871 恒空）→ 加括号并按有无数据源分别生成；②无数据源时不再生成 `undefined ??` 前缀；③未使用 row 别名。
- 样例：采购入库/销售出库两个表单的明细加数据源（注意首次脚本插错了 dialog——已按 dialog 块配平精确定位修正）。
- 实测：322 单测全绿、九包 typecheck ✓、spec 1091 项 100%、react tsc+build ✓。

## 2026-09-16 续十一（明细数据源通用化：覆盖全部 11 个带明细表单）
- 追问"所有的都修了吗"——上一轮只覆盖了有详情 DTO 的两个（采购入库/销售出库）。本轮通用化：
  - codegen：repeat dataSource 支持**两种返回形态**——`List<T>` → `q.data` 直接当数组；结构体 → `q.data.<field>`（按 logic 返回类型自动判别）。
  - yudao：为其余 9 个带明细的表单补「明细列表查询 + 端点 + dataSource」：
    库存盘点 items、采购订单/退货/付款 items、销售订单/退货/收款 items、CRM 商机 products、CRM 合同 products
    （路径如 `GET '/api/erp/purchase-orders/{orderId}/items' -> queryErpPurchaseOrderItems`）。
  - 采购入库/销售出库仍走详情 DTO 版本（同时补全区块字段）——两种形态并存且有测试锁定。
- 真机：`purchase-orders/1/items`、`purchase-ins/1/detail`、`sale-orders/1/items`、`crm/contracts/1/products`、`crm/businesses/1/products` 均 200 返回明细；322 单测 / typecheck / java clean compile / react tsc+build / seed 105-0。
