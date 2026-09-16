# 22 系统设计：M8 —— CLI（`dsl` 命令行工具）

> 关联：`10_设计/设计总览.md` §模块规划（`ttdsl parse/check/generate/build`）、`dev/21`（M7 多文件工程，`parseProject` 直接复用）、`dev/14`（P2 工程化）
> 状态：**已实现（编码/测试完成，2026-09）** —— `packages/cli`（bin `dsl`，14 单测；`tdsl build examples/todo-multi/tdsl` 双端 build 通过）
> 定位：命令行编译入口——多 AI 产出的 `.tdsl` 目录 → parse/check/generate/build 四步落地；**编译服务的地基**（命令逻辑薄封装可复用 API 层，未来常驻服务直接调用同一层）。

---

## 1. 目标与验收

### 1.1 背景

- M7 落地了 `parseProject(files)` 多文件编译 API，但其消费方目前只有 `slice.ts` / `slice-multi.ts` 两个一次性脚本。
- **缺口**：没有统一入口。想"编译一个 TDSL 工程"需要复制脚本；LLM 协作产出多文件后需要一条命令验证可编译性；评测基准（可编译率/build 通过率）也需要稳定入口。
- 设计总览既有规划：`ttdsl parse/check/generate/build`。

### 1.2 达成什么

新建 `packages/cli`（`@tdsl/cli`，bin 名 `dsl`）：

| 命令 | 行为 | 退出码 |
|------|------|--------|
| `tdsl parse <dir\|file>` | 编译（parse+link）并打印摘要（各段数量）；`--json` 输出完整 AST JSON | 失败 1 |
| `tdsl check <dir\|file>` | parse + typecheck，打印诊断（file + path + message），无诊断打印 `✓ N 段，0 问题` | 有 error 1 |
| `tdsl generate <dir> [-o out] [--java\|--react]` | 生成并写盘（默认 `generated/`，即 `generated/java` + `generated/react`） | 失败 1 |
| `tdsl build <dir> [-o out]` | generate + `mvn -q -DskipTests compile` + `npm install && vite build`（与 slice 同路径） | 任一步失败 1 |
| `tdsl help` / 无参 | 命令帮助 | 0 |

约定：

- **输入**：目录（扫描顶层 `*.tdsl`，按文件名排序 → `parseProject`）或单文件（`parseProject` 单元素）。M7 语义完全复用。
- **app 名**：`--name <x>` 指定；缺省取目录名，**清洗为合法 Java 标识符**（去非 `[A-Za-z0-9_]`、首字符非字母则补前缀 `app`；结果空则 `app`）——codegen-java 的校验是最后一道防线，CLI 在入口给人话提示。
- **输出人话化**：诊断行格式 `[error] b.tdsl app.logics.bad: 悬空引用: X`（file 有则带，`<stdin>` 不带）；parse 错误带行列（沿用 `TdslSyntaxError`）。
- **写盘边界**：只有 `generate/build` 写盘（codegen 纯函数约定不变）；`parse/check` 永不写盘。
- `build` 依赖本机 Java 17 + Maven + Node（已在工具链约定内），缺失时命令报人话错误。

### 1.3 验收标准（全部达成）

- [x] `packages/cli` 单测（14 个，vitest 逻辑层）：命令分派、目录扫描排序、app 名清洗规则、诊断人话格式、退出码。
- [x] 端到端：`tdsl check examples/todo-multi/tdsl` 退出 0；加坏分片 `99_bad.tdsl` → `[error] 99_bad.tdsl app.logics.bad: 实体 Order 无字段 nofield` 且退出码 1。
- [x] `tdsl build examples/todo-multi/tdsl`：mvn compile + vite build 通过（java 20 files + react 12 files）。
- [x] bin 可执行：`npm run tdsl -- help`（tsx ESM register 加载 TS 源，零新增构建链）。
- [x] 不回归：`npm test`（169）与 `npm run typecheck`（含 cli 八包）全绿。

### 1.4 范围外

- 编译服务常驻（P3）、watch 模式、TDSL→JSON→TDSL 互转（设计总览里的试验台能力，另切面）
- 缓存/增量编译、并行编译
- `dsl init` / 脚手架（未来切面）
- 发布为全局 npm 包（当前 private workspace 内用）

---

## 2. 设计决策

| # | 决策 | 理由 |
|---|------|------|
| D-M8-1 | 命令逻辑做成**薄命令层 + 可复用 lib 函数**（`runParse/runCheck/runGenerate/runBuild` 返回结构化结果，`bin` 只做 argv 分派与打印） | 编译服务（P3 常驻）直接复用 lib 层；vitest 可测逻辑层不打 shell |
| D-M8-2 | **零新增依赖**：argv 解析手写（命令只有 4 个，参数≤3 个）；tsx 复用现有 devDep | CLI 是胶水层，依赖越少越稳；不引 commander/yargs |
| D-M8-3 | 运行时形态：`bin/tdsl.mjs` 用 tsx 的 ESM register API 加载 TS 源码（`import { register } from 'tsx/esm/api'`），**不新增 tsc 构建链** | 全仓 packages 均以 TS 源为 main（已确认），不单独为 CLI 开构建产物，避免双份构建配置漂移 |
| D-M8-4 | 目录扫描**只扫顶层** `*.tdsl`（文件名排序），不递归 | 与 M7 示例形态一致；递归策略留给未来真实需求（避免子目录产物/备份文件误入） |
| D-M8-5 | app 名缺省=目录名清洗；`generate` 输出默认 `<cwd 或 -o>/generated/{java,react}` | 与 `examples/todo-app/generated` 既有形态一致 |
| D-M8-6 | 诊断人话化在 CLI 打印层统一处理（`<stdin>` 隐藏、file 缺省不显示），不改 typecheck | 展示策略归展示层 |

---

## 3. 结构

```
packages/cli/
  package.json        # name @tdsl/cli, bin: { tdsl: bin/tdsl.mjs }, deps: 五包 + tsx(dev)
  bin/tdsl.mjs         # shebang + tsx register + import('../src/index.ts')
  src/
    index.ts          # run(argv): 命令分派 → lib 函数 → 打印 → exit code
    commands.ts       # runParse/runCheck/runGenerate/runBuild（可复用 lib，返回结果对象）
    input.ts          # 解析 dir|file → TdslSourceFile[]（扫描排序）+ appName 清洗
    print.ts          # 诊断/摘要/AST JSON 人话化输出
  test/
    cli.test.ts       # 逻辑层单测（tmp 目录驱动，不打 shell；build 命令仅测输入校验与分派）
```

`run(argv)` 的返回：`{ code: number, stdout: string }`——bin 层 `console.log` + `process.exitCode`；单测直接断言对象。

---

## 4. 测试计划

| 组 | 用例 | 数量 |
|----|------|------|
| input | 目录扫描（排序/只认 .tdsl/忽略其他扩展）；单文件；不存在路径报错；app 名清洗（todo-multi→todomulti、中文/数字开头→app 前缀、空→app） | ~5 |
| commands | runParse 摘要 + --json；runCheck 无诊断/有诊断退出码与格式（含 file 列）；runGenerate 写盘文件数与路径 | ~5 |
| bin | --help / 无参 / 未知命令退出码 | ~2 |
| 端到端 | `tdsl check examples/todo-multi/tdsl` 退出 0；改坏分片 → 退出 1（单测临时副本目录驱动） | 脚本级 |

预计新增 ~12 单测（155 → ~167）。

---

## 5. QA 记录

| 日期 | 阶段 | 问题 | 结论 |
|------|------|------|------|
| 2026-09 | 需求 | CLI 与 M7 多文件的关系？ | CLI 是 parseProject 的首个生产消费者（M7 设计文档 1.4 已预留目录扫描给 CLI） |
| 2026-09 | 设计 | 是否引入 commander？ | 不引入（D-M8-2），4 命令 3 参数不值得多一个依赖 |
| 2026-09 | 编码 | `type AppNode` 从 `@tdsl/parser` 导入但 parser 不导出该类型 → TS 静默当 any，reduce 回调报隐式 any 才暴露 | 语义核类型一律从 `@tdsl/core` 导入（playground 也是这么做的）；已入库踩坑 |
