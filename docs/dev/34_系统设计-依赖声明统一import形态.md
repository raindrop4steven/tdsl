# dev/34 系统设计 — 依赖声明统一 import 形态

> 切面：dev/32 依赖声明的语法升级。背景（用户两轮拍板）：
> ①一包多组件（@ant-design/charts 有 Pie/Bar/Line）一个 `as` 不够；
> ②npm 用 `as` 语义错位（实际是 import）；③java `as` 消解的是 jar 不是类——两概念混在一个词里。
> 最终形态（用户定）：`dependency xxx "坐标" [as ns] [import X | import { A, B as C }]`。
> 状态：已交付（2026-09-13）

## 1. 统一语法

```
dependency java "com.alibaba:fastjson2:2.0.58" import { JSON, JSONObject };
dependency java "com.fasterxml:jackson:2.17.0" as jackson import { JSON };
dependency npm "echarts-for-react" import ECharts;               // 单名 = 默认导出
dependency npm "@ant-design/charts" import { Pie, Bar, Line };   // 花括号 = 具名导出
dependency npm "dayjs";                                          // 纯依赖（只进 package.json）
```

| 段 | 语义 |
|----|------|
| `as ns`（可选） | **jar 级命名空间**：撞名时该包产物类以 `ns.Alias` 限定引用（dev/32 语义保留）；npm 侧语法位保留、当前无消费场景 |
| `import X` | 默认导入：npm → `import X from 'pkg'`；java → 产物类 X 以裸 alias 进有效目录 |
| `import { A, B as C }` | 具名导入：npm → `import { A, C } from 'pkg'`（B 改名 C）；java → 类 A、B 进裸名，B 的 TDSL alias 为 C（撞名消解在 import 列表内完成） |
| 无 import | java：产物类**全量**进裸名（兼容现状）；npm：只进 package.json |

## 2. 改动清单

- core：`DependencyNode` 增 `imports?: Array<{ name, alias? }>`、`importDefault?: string`；`createCatalog` java 侧支持 imports 显式收窄（无 import 全量）+ import 内 alias 改名
- parser：`parseDependency` 解析 `[as ns] [import X | import { A, B as C }]`
- typecheck：三方组件匹配 = 遍历 npm 声明的 imports（alias 或 name）∪ ns ∪ 尾段 norm 兜底
- codegen-react：页面三方组件 import 生成——默认导出 `import X from 'pkg'` / 具名 `import { A, B } from 'pkg'`（按组件名命中声明）
- codegen-java：无行为变化（FQN import 不变）；ns.Alias 限定引用保留

## 3. 验收标准

1. parser 解析五种形态（单测）
2. npm 默认导出/具名导出的 import 生成正确（codegen-react 单测，@ant-design/charts 多组件场景）
3. java import 列表显式收窄 + `B as C` 改名（core 单测）
4. 全量回归绿

## QA 记录

| 日期 | 阶段 | 结论 |
|------|------|------|
| 2026-09-13 | 需求/设计 | 用户三轮收敛：一包多组件 → as 语义错位 → as 消解 jar 非类 → 定统一形态 `[as ns] import {…}` |
| 2026-09-13 | 编码/测试 | core DependencyNode 扩展（imports/importDefault）+ parser 五形态解析 + typecheck 三方组件按 imports 匹配（显式导入后不再尾段兜底）+ codegen-react 按导入形态生成（默认 `import X from 'pkg'` / 具名同包聚合 `import { Pie, Bar } from 'pkg'`）+ 手册/cheatsheet/示例同步。272 单测全绿、slice/slice:multi/check-spec 100% |
