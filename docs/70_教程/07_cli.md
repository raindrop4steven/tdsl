# 07 cli：命令行工具（M8 + dev/32）

> 配套代码：`packages/cli/src/`（commands 248 行 / index 122 行 / input 103 行）+ `bin/dsl.mjs`
> 定位：编译器的**人机入口**。五个命令覆盖"看 AST / 验语义 / 出代码 / 真构建 / 接第三方 jar"。

## 1. 命令全景

```
dsl parse   <dir|file> [--json]              # 编译 + 摘要（--json 出完整 AST）
dsl check   <dir|file>                       # parse + typecheck，诊断人话化（error 退出码 1）
dsl generate <dir|file> -o <dir> [--java|--react]   # 双端 codegen 并写盘
dsl build   <dir|file> -o <dir>              # generate + mvn compile + vite build（与 slice 同路径）
dsl bundle-jar <jar> -o <json> [--classes 简名] [--coord g:a:v]   # jar 扫描为依赖产物（dev/32）
```

输入是**目录或单文件**：目录 → 顶层 `*.tdsl` 按文件名排序（M7 分片形态）；app 名 `--name` 指定，缺省取目录名清洗为合法 Java 标识符（`sanitizeAppName`，codegen 包名校验是最后防线）。

## 2. 薄命令层设计（最值得学的一处）

`commands.ts` 的每个 `runXxx` 都是**纯逻辑函数**：`run(argv) → {code, stdout}`，不打印不退出——bin 层（`index.ts` 的 `main`）只负责打印与设退出码。

收益：

1. **测试直接断言**：`packages/cli/test/cli.test.ts` 18 个用例全走 `run()`，不起子进程
2. **编译服务可复用**：常驻进程（P3 方向）直接 import 逻辑层，零改动
3. **退出码语义统一**：编译失败/诊断有 error/未知选项都是 code 1

## 3. libs loader 与依赖装载（dev/32）

`check` / `generate` 前自动调 `loadLibs(baseDir)`：读 `<tdsl 目录>/libs/*.json` → 校验头对象格式（`{eco, coordinate, classes}`，非法报人话错误）→ 作为 `opts.libs` 传入 typecheck / codegen-java。

**IO 边界纪律**：loader 在 cli（IO 层），core/typecheck 保持纯函数——同一个 `check(app, {libs})` 签名，cli 从磁盘喂、server 从沙箱喂、单测手工喂。

## 4. bundle-jar：第三方 jar → 依赖产物

```
jar tf        → 类清单（过滤内部类/package-info/module-info）
javap -s -p   → 逐类签名 → 成员列表（static/params/ret）
--classes     → 过滤（简名/后缀，如 JSON,JSONObject）
坐标自动取     → jar 内 META-INF/maven/**/pom.properties（--coord 可覆盖）
```

产物是**带头对象**（不是裸数组）：

```json
{ "eco": "java", "coordinate": "com.alibaba:fastjson2:2.0.58", "classes": [...] }
```

**人工收窄**是质量闸门：机器扫全量（fastjson2 有 527 类），人精选 3 类、修 alias、补 java/js 模板。产物放工程 `libs/` 后，配合 TDSL 的 `dependency java "g:a:v";` 声明，check/generate 自动生效。

## 5. 本包要记住的 3 件事

1. **命令层薄、逻辑层厚**：`run(argv)` 可测可复用，打印与退出码只在 bin。
2. **人话化诊断**：`[error] a.tdsl app.logics.f: 悬空引用: ...`——file + path + message 一行，LLM 与人都能直接读。
3. **bundle-jar 是扫描器不是集成器**：产物必须人工收窄后才放 libs/，"全量反射 → 精选"的收敛由人把关。

**动手练习**：`npm run dsl -- check examples/fastjson-demo/demo.tdsl`，然后删掉 `libs/fastjson2.json` 再跑，对比 D-dep-2 的 warning 输出；再用 `--classes JSON` 重新扫描生成产物。
