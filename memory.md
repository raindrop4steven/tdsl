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
