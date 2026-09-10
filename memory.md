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

## 3. 当前状态快照（2026-09，Playground 交付后）

- **169 单测全绿**：core 5 / parser 48 / typecheck 35 / codegen-java 30 / codegen-react 18 / llm 13 / playground 6 / cli 14；八包 strict typecheck 通过。
- 演示入口：`npm run playground`（http://localhost:5173，离线可用）；端到端：`npm run slice`（单文件）+ `npm run slice:multi`（M7 多文件对拍）；CLI：`npm run dsl -- check/build examples/todo-multi/tdsl`。
- **下一步**（按当前优先级）：真实 LLM 接入（provider 适配层，CLI/管线已具备）→ 评测基准（可编译率/build 通过率，CLI 是天然采集器）→ M3/M5 视需求排期。

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

## 4. 踩过的坑（后来者必读）

| 坑 | 教训 |
|----|------|
| link 阶段错误带 `line 0/col 0`，回流 LLM 会显示"第 0 行" | 面向 LLM 的错误反馈必须人话化：line/col 无意义时换引导语（validateTdsl 已处理；`ParseErrorInfo.linkStage` 标记） |
| `crypto.randomUUID()` 仅安全上下文可用 | localhost OK，**局域网 http IP（会议室投屏）会抛异常**；`core/id.ts` 已加 uuid v4 fallback——以后新增环境相关 API 要先想演示场景 |
| 批量 sed 改文档会产生重复/错误引用（如"设计总览 与 设计总览"） | 批量改文档后必须 grep 残留 + 人工抽查 |
| `@tdsl/llm` 示例矩阵第一版就有内容 bug（Order 漏 total 字段） | "可编译性单测"不只是防漂移，还能抓示例本身的内容错误 |
| Monaco 主 chunk ~3.5MB，vite build 有警告 | 演示场景接受；未来要优化用 manualChunks 拆 monaco |
| 设计文档会滞后于代码（dev/14 现状盘点写于 M1 前） | 任何"现状"结论以实测为准：`npm test` + 读源码 |
| 字符串比较式判重（`existing !== path`）对"同名同段"恒失效（path 恒等）→ 重名 logic 一直漏报 | 判重逻辑不能依赖 path 差异做同名检测；新增概念时补"同段同名"单测 |
| app 名直接拿去当 Java 包名，带连字符就生成非法代码（app 名参数化 M7 才暴露） | 环境相关/外部拼入标识符的值，入口处校验合法性并抛清晰错误，不静默变形 |
| `type AppNode` 从 `@tdsl/parser` 导入但 parser 不导出该类型 → TS 静默当 any，直到隐式 any 报错才暴露 | 语义核类型一律从 `@tdsl/core` 导入；新增包入口时检查 re-export 面 |

## 5. 文档地图（简化后的最终形态）

```
AGENTS.md            # 怎么干活（稳定）
memory.md            # 本文件：干过什么（演进）
docs/00_参考资料/     # NASL 调研（对标起点）
docs/10_设计/设计总览.md   # 设计一份读完（D1-D7/架构/类型速览/里程碑地图）
docs/70_教程/         # 学习路径（00-05 P0 入门；06 Tour = 最新全景 + 源码导读）
docs/dev/11~20        # 切面研发文档（11=M3 未来设计；12-20=已落地里程碑）+ QA记录.xlsx
docs/index.html       # 文档索引（每次新增/修改文档后同步更新）
```
