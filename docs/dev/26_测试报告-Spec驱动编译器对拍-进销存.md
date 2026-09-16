# 系统设计/测试报告 26：Spec 驱动编译器对拍——进销存系统实战

> <rv-add>本文档为本切面新增（2026-09）。背景：一句话生成无法让 LLM"猜"出按钮级需求，
> 对标网易 CodeWave 的 Spec 驱动开发（SDD）路线：**结构化 Spec（机器可读）→ TDSL → 编译器自动对照**。
> 本切面交付：进销存完整 Spec + Spec 覆盖度对照器 + 全套 TDSL 实现，并用它实测编译器表达力与正确性。</rv-add>

---

## 1. 目标与验收标准

| # | 验收标准 | 结果 |
|---|---------|------|
| 1 | Spec 结构化（系统→模块→功能→页面→按钮→字段 六层），机器可读 | ✅ `examples/jxc/spec.yaml` |
| 2 | 覆盖度对照器自动对拍（实体/字段/枚举/页面/按钮/动作绑定），缺口非零 exit 1 | ✅ `examples/jxc/scripts/check-spec.ts`，287 检查项 100% 覆盖 |
| 3 | TDSL 全量实现 Spec 并通过 typecheck | ✅ 6 分片，32 logic，0 诊断 |
| 4 | 双端真实构建 | ✅ Java 80 文件 mvn compile ✓；React 25 文件 vite build ✓ |
| 5 | 不破坏存量：全仓单测 + slice + slice:multi 回归 | ✅ 208 用例全绿（含新增 7 个锁定用例） |

## 2. 交付物

```
examples/jxc/
  spec.yaml              # 进销存结构化 Spec（5 模块/8 功能/15 页面/32 按钮/13 实体/5 枚举/129 字段）
  tdsl/*.tdsl            # 6 分片实现：00-model / 10-base-data / 20-purchase / 30-sales / 40-inventory / 50-finance
  scripts/check-spec.ts  # 覆盖度对照器：五维（实体字段/枚举/页面[列·表单·子表]/按钮/动作绑定），js-yaml + @tdsl/parser
  generated/             # CLI 产物（gitignore 性质）
```

Spec 格式要点（v1 实践定型）：
- `data` 全局数据字典：enums（key+label）/entities（fields: id/type/required/name）
- `modules→functions→pages`：页面 id 即 TDSL page/dialog 名；kind ∈ list/dialog-form/detail
- 页面携带 `query`（主查询逻辑）、`columns`（列表列）、`search`（查询条件字段）、`fields`（表单字段）、
  `subform`（主子表明细：repeat 名 + 明细实体 + 字段）、`buttons`（name 与页面 button text 一致；action ∈ openDialog/logic/navigate）
- 对照语义：**结构覆盖对照**（存在性/类型相容/绑定在场），不做语义等价判定

## 3. 业务范围（来源：Known 框架 JxcLite 进销存需求，裁剪导入/导出/附件/打印/权限/用户管理）

5 模块：基础数据（商品/供应商/客户，数据字典→枚举映射）、采购管理（进货单主子表：暂存/提交/删除/复制/整单退货）、
销售管理（销货单同构）、库存查询（进销存汇总）、应收应付（确认→开票→回款状态机）。
单据仅 暂存/已提交 两态，不含审批流。

## 4. 编译器缺陷发现与修复（本轮实测的直接产出）

### 4.1 已修复（双端 codegen，均补锁定单测）

| # | 缺陷 | 修复 |
|---|------|------|
| F2 | `List<Struct>` 作返回值/泛型实参时，Service/Controller 的 `structure.*` import 漏收集 → javac 找不到符号 | `typeUsesStructure` 递归泛型实参（codegen-java） |
| F3 | logic 体内 Decimal 比较 `>=` 直出（BigDecimal 无运算符重载）→ 编译错 | 翻译为 `compareTo(...) op 0`（codegen-java） |
| F4 | 整数字面量 `:=` 累加器生成 int，与实体 Integer（getter Long）运算精度损失 → 编译错 | 字面量声明 `long x = 0L`（codegen-java） |
| F5 | api.ts POST 多参数逐个命名 `body` → Duplicate identifier | 具名参数 + `JSON.stringify({ id, amount })` 打包（codegen-react） |
| F6 | DatePicker onChange dateString 为 `string \| string[]`，与 `useState<string>` 冲突 → tsc 报错 | `String(s ?? '')` 归一（codegen-react） |
| F8 | `import enums.*` 无条件发射（#34481cd 引入），无枚举 app 的 enums 包不存在 → **slice:multi 自 #14 起实际是坏的** | `enumsImport` 按 app 有无枚举条件发射（codegen-java，5 处） |

### 4.2 记录未修（表达力缺口，作为语言演进输入）

<rv-add>### 4.1.2 三层质量网盲区（2026-09 实战追加）

| 缺陷 | 定性 | 盲区在谁 | 治理方向 |
|------|------|---------|---------|
| 弹窗双提交按钮（DSL 内嵌按钮被静默丢弃 + 文案硬编码） | codegen 模板 | 单测只锁单按钮形态 | 隐含产物 import/文案採 DSL 声明；加 dialog 场景锁定用例 |
| dialog 内调需参 logic → 运行时 500（row 上下文悬空） | TDSL 语义错 + codegen 宽松补参 | typecheck 不查"调用处实参可达性" | M3：binding 实参静态可达检查（dialog 内 row 为悬空引用应报 error） |
| TDSL 超出 spec（行上多投提交按钮） | TDSL 写多了 | check-spec 单向对照（只报缺不报冗余） | check-spec 增反向告警：TDSL 中 spec 未声明的页面/按钮报 warn |

> 结论：三层网各有盲区——typecheck 管"编译合法"，check-spec 管"需求覆盖"，**没人管"语义意图正确"**。
> 真实 spec 驱动对拍是发现这类问题的唯一途径，应成为常态化验证入口。</rv-add>

| # | 缺口 | 说明 |
|---|------|------|
| C1 | `X.where(...).aggregate(...)` 链不支持 | typecheck 查询链白名单（orderBy/page/limit/groupBy）无 aggregate；汇总场景只能 for-in 内存手算（N+1）。建议 M3 补 |
| G1 | 枚举项无中文 label | EnumItem 只有 name，Select 选项 label=value；业务字典（如"现金/对账"）中文显示无处安放 |
| G2 | 表单联动无法表达 | "商品选择自动带出档案""数量×单价实时算金额"只能落后端 logic，前端 onChange 联动无语法 |
| G3 | 查询条件到查询参数不接线 | search 输入框在场但值未传入 useQuery；页面绑定层无查询参数语法 |
| G4 | 跨实体 join 汇总无单语句表达 | 库存汇总需跨 4 张明细表，当前靠内存合并 |
| G5 | 行按钮参数不全时无输入面 | 如"开票"需录发票号，行内动作无弹窗录入语法（dialog 可绕但需拆页面） |
| F7 | POST 多标量参数后端侧非法 | 前端已打包 body 对象，Java 端仍生成多 @RequestBody（编译过、运行时非法），需同构 DTO 打包 |

## 5. QA 记录

- 首轮对照 91.6% → 缺口两类：检查器 target nodePath 匹配（链接后 `app.logics.x`）+ 漏写 2 个退货列表页 → 修复后 100%
- mvn 首轮暴露 F2/F3/F4；react tsc 轮暴露 F5/F6；slice:multi 回归暴露 F8（存量缺陷，stash 验证与本次修改无关）
- 命令：`npm run check-spec -w jxc`；`npm run tdsl -- build examples/jxc/tdsl -o examples/jxc/generated --name jxc`
- 注意：CLI 不带 `-o` 时产物写当前目录 `./generated`（曾误写仓库根，已清）
</content>
