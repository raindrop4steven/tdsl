# 23 系统设计：M9 —— LLM 接入（嵌入 pi Agent 的在线 TDSL 工程 Agent）

> 关联：`dev/19`（Prompt Pack 资产复用）、`dev/21`（M7 多文件 = agent 的写入单位）、`dev/22`（CLI，compile 工具与它同管线）、pi SDK 文档（`@earendil-works/pi-coding-agent` docs/sdk.md）
> 状态：**设计中（需求/方向 Gate 已过 2026-09，编码待开始）**
> 定位：**在线 TDSL 工程 Agent**——独立 Web 服务，浏览器里即"TDSL 版 claude code"：用户提需求，agent 写多文件分片 → 调编译器 → 读诊断 → 自修到编译通过。
> 形态：**不自研 agent 运行时**，嵌入 pi SDK（会话/压缩/工具循环/流式全部白送），我们只写 TDSL 领域层。

---

## 1. 目标与验收

### 1.1 背景与选型结论

- dev/19 已产出 Prompt Pack 全套资产（示例矩阵/cheatsheet/prompt 组装/validateTdsl 裁判），缺"真调用"。
- 原自研方案（provider 层+上下文压缩+turn loop）被 **pi SDK 嵌入方案替代**：会话管理、上下文压缩（`compact()`）、工具循环、流式事件、多 provider、会话持久化——pi 全部内置。
- 我们的核心资产恰好是 agent 最稀缺的东西：**确定性编译裁判**（parse+typecheck 秒级免费人话诊断）。agent 的核心循环"写分片→编译→读错→再改"天然闭环。
- M7 多文件工程（`parseProject`）让 agent 以"功能域分片"为单位写文件——每个分片一次工具调用，出错只修一个文件。

### 1.2 达成什么

新建 `packages/server`（`@tdsl/server`，HTTP+WebSocket）：

1. **嵌入 pi**：`createAgentSession`（cwd=会话沙箱目录），系统提示词 = TDSL 语法 cheatsheet + 示例策略（`systemPromptOverride`）。
2. **TDSL 领域工具**（`defineTool`，白名单**不含 bash**）：
   - `compile_tdsl`：读沙箱 `*.tdsl` → `parseProject` + `check` → 结构化诊断（file/path/message 人话化）→ 回流 agent（★核心，M7+M8 能力的薄封装）
   - `read_tdsl_files` / `write_tdsl_files`：沙箱内多文件读写（M7 分片，agent 按功能域逐个写）
   - `generate_code`：对沙箱当前 TDSL 跑双端 codegen，返回文件清单+关键产物摘要（供 agent 自检与前端展示）
3. **Web 端**：HTTP 提供静态页面 + WebSocket 转发 pi 事件流（流式文本、工具调用、诊断展示）；聊天面板 + 文件树 + 编译结果面板。
4. **模型配置**：pi 的 provider 机制（`models.json` 覆盖 / `pi.registerProvider`），key 全在服务端 env，**浏览器永不接触 key**。
5. **会话**：每会话独立沙箱目录 + pi session 持久化（可回放）；并发多会话。

### 1.3 验收标准

- [ ] `npm run server` 启动 → 浏览器聊天：输入需求 → agent 自主多轮写 `.tdsl` → 调 `compile_tdsl` → 修到编译通过 → 展示生成代码，全程流式可见。
- [ ] 故意在对话中要求引用不存在的实体 → agent 调 `compile_tdsl` 拿到 `[error] file path: message` 诊断后自行修复（观测工具调用轨迹）。
- [ ] 多文件场景：一个需求 ≥2 个功能域分片，agent 分别 write 后逐个编译（M7 语义工作正常）。
- [ ] 领导演示离线兜底：无外网/无 key 时可用 **本地模型端点**（vLLM/Ollama，OpenAI 兼容 baseUrl）演示完整 agent 循环。
- [ ] 安全：工具白名单无 bash/shell；沙箱目录外不可写；key 不出现在任何响应流。
- [ ] 单测（逻辑层）：TDSL 工具（compile/read/write/generate 对临时沙箱）；会话沙箱生命周期；诊断→工具结果格式。pi 循环本身不测（上游）。
- [ ] 不回归：`npm test`（169+）与 `npm run typecheck`（九包）全绿。

### 1.4 范围外

- 自研 provider/压缩/循环（pi 承担）；评测基准（下一切面，吃 pi session 记录）
- 生产化（鉴权/多租户/限流/HTTPS）；文件上传/图片
- playground 内嵌 AI 按钮（服务稳定后另做）
- Mock provider（本地 OpenAI 兼容端点已足够兜底；真要无 LLM 演示用 playground 既有管线）

---

## 2. 设计决策

| # | 决策 | 理由 |
|---|------|------|
| D-M9-1 | **嵌入 pi SDK（进程内 `AgentSession`），不自研 agent 运行时** | 四层能力（传输/循环/压缩/会话）免费；官方文档明示 Node 用 SDK 而非 RPC 子进程 |
| D-M9-2 | 工具白名单**只含 TDSL 工具，不含 bash** | 服务场景不需要 shell；缩攻击面；agent 行为全部经由可审计的工具 |
| D-M9-3 | 每会话一个**沙箱目录**（`sessions/<id>/tdsl/`），pi cwd 绑定它 | 文件即状态：agent 用 write/read 工具操作 M7 分片；compile 工具天然作用整个目录；会话隔离+可清理 |
| D-M9-4 | 系统提示词由 `systemPromptOverride` 注入 **Prompt Pack 精简版**（cheatsheet 全文 + 示例策略说明），示例全文按需由 agent 读文件获取 | pi 已做上下文管理，注入物要克制；示例矩阵落沙箱 `examples/` 目录，agent 用 read 工具按需检索（示例主导三原则的 agent 化） |
| D-M9-5 | `compile_tdsl` 返回**人话诊断**（复用 `humanizePath` + M7 `file` 字段 + CLI 格式），不返回裸 AST | 报错消息是 agent 的反馈信号质量决定修复轮数；dev/19 裁判格式直接复用 |
| D-M9-6 | 事件流走 **WebSocket**（pi `subscribe` → WS 转发） | 流式 + 工具调用过程可视化是演示的核心卖点；HTTP 只做静态页 |
| D-M9-7 | provider 配置：优先 `models.json` 覆盖（baseUrl/key 指 OpenAI 兼容端点），env 提供 key | 演示可切 DeepSeek/Qwen/Ollama/vLLM；**离线兜底** = 本地端点，不需要 mock provider |
| D-M9-8 | 服务与编译器解耦：`packages/server` 依赖 `@tdsl/parser/typecheck/codegen-*`（库层）**不依赖 CLI 包** | CLI 是进程外形态；进程内直接调库（M8 的 lib 层如果 server 需要命令输出再复用） |

---

## 3. 架构

```
浏览器（静态页 + WS 客户端）
   │ WS: pi 事件流（text_delta / tool_call / tool_result / agent_end）
   ▼
packages/server
   ├─ http.ts        # 静态页面 + /ws 升级
   ├─ sessions.ts    # 会话表：id → { AgentSession, 沙箱目录 }；create/close/列表
   ├─ workspace.ts   # 沙箱目录创建/清理（sessions/<id>/tdsl/ + examples/ 注入）
   ├─ tools.ts       # defineTool × 4：compile_tdsl / read_tdsl_files / write_tdsl_files / generate_code
   ├─ prompt.ts      # systemPromptOverride（cheatsheet + agent 策略）+ 示例文件落沙箱
   └─ index.ts       # 装配：createAgentSession({ resourceLoader, customTools, sessionManager })
```

### 3.1 工具明细

| 工具 | 参数 | 行为 | 返回 |
|------|------|------|------|
| `write_tdsl_files` | `files: [{path, content}]` | 写入沙箱 `tdsl/`（path 校验：仅 `*.tdsl`、防穿越） | 写入清单 |
| `read_tdsl_files` | `paths?: string[]` | 读沙箱 `tdsl/`（缺省=全部清单） | 文件内容/清单 |
| `compile_tdsl` | `—` | `parseProject(沙箱分片, appName)` + `check`；含 parse 错误 | `✓/诊断列表`（人话，带 file）+ 各段数量 |
| `generate_code` | `—` | 双端 `generateJava/generateReact`（不写盘不 build） | 文件清单 + 按需内容摘要 |

设计要点：

- `compile_tdsl` 是 agent 与编译器之间的**唯一裁判接口**，内部复用 `@tdsl/parser`+`@tdsl/typecheck`（库直调，非子进程）。
- 工具结果同时进 agent 上下文与**服务端事件流**（前端展示"agent 做了什么"）。
- 分片校验由编译器承担（M7 重名/悬空/诊断全带 file），工具层只做路径安全与格式化。

### 3.2 会话生命周期

1. `POST /api/session` → 创建沙箱目录 + `createAgentSession`（注入 prompt + tools）→ 返回 sessionId。
2. WS 连接绑定 sessionId；用户消息 → `session.prompt(text)`；pi 事件 → WS 下发。
3. agent 循环：LLM 生成/改写分片（write 工具）→ compile（compile 工具）→ 修错 → 完成（文本总结 + generate_code 展示）。
4. 上下文增长 → pi `compact()`（阈值由 pi 处理；必要时服务端调）。
5. 会话关闭：session 文件已持久化（回放/评测原料）；沙箱目录保留至 TTL。

### 3.3 依赖与配置

| 项 | 方案 |
|----|------|
| pi 依赖 | `npm i @earendil-works/pi-coding-agent`（workspace devDep→deps；版本锁定） |
| 模型 | `models.json` 覆盖或 env：`TDSL_LLM_BASE_URL` / `TDSL_LLM_API_KEY` / `TDSL_LLM_MODEL`（OpenAI 兼容端点，含本地 vLLM/Ollama） |
| key 安全 | 仅服务端 env；WS 事件只含文本/工具调用，无请求头 |
| 端口 | `8787`（`npm run server`） |
| 会话存储 | `packages/server/.sessions/`（gitignore） |

---

## 4. 测试计划

| 组 | 用例 | 数量 |
|----|------|------|
| workspace | 沙箱创建/清理；路径穿越/非 .tdsl 拒绝；分片清单 | ~4 |
| tools | compile_tdsl：正常目录→✓+数量；坏分片→诊断带 file；空目录；read/write 往返 | ~4 |
| prompt | systemPromptOverride 含 cheatsheet 关键字；示例文件注入沙箱 | ~2 |
| server | 会话创建/复用/并发隔离（两个会话沙箱互不可见） | ~3 |
| e2e | 手工：浏览器全流程（对话→工具轨迹→编译通过→产物预览） | 手工验收 |

预计新增 ~13 单测（169 → ~182）。**pi 的循环/压缩不进单测**（外部行为，文档级信任 + e2e 手工）。

---

## 5. 风险与对策

| 风险 | 对策 |
|------|------|
| pi SDK 版本演进破坏嵌入 API | 版本锁死；SDK 属正式公开面（docs+examples 齐全）；嵌入面收窄到 `createAgentSession/defineTool/subscribe/compact` 四个 API |
| agent 轮数失控/token 烧钱 | 系统提示词写明"编译通过即停"；compile ✓ 后不给继续理由；会话记录统计轮数（评测原料） |
| 本地无外网演示 | Ollama/vLLM 本地端点（OpenAI 兼容），无 key 依赖 |
| WS 断线重连 | 会话持久化（pi session），WS 重连后补拉 session messages 摘要 |

---

## 6. QA 记录

| 日期 | 阶段 | 问题 | 结论 |
|------|------|------|------|
| 2026-09 | 需求 Gate | 自研 agent 运行时 vs 嵌入 pi SDK？ | **嵌入 pi SDK**（用户决策）：压缩/循环/会话免费，自研只剩领域层 |
| 2026-09 | 需求 Gate | 在线服务还是 CLI/skill？ | 独立 Web 服务（演示价值 + 多用户在线使用） |
| 2026-09 | 设计 | 离线兜底要不要 MockProvider？ | 不做 mock——本地 OpenAI 兼容端点（Ollama/vLLM）兜底，真实且免费 |
