# 03 typecheck：六类诊断与宽松策略

> 配套代码：`packages/typecheck/src/index.ts`（单文件 1239 行）
> 定位：`check(app, { libs })` → `{ ok, diagnostics }`。**任何入口进 AST 后的统一安全网**——parser、多文件合并、未来 JSON 直出，都过这一关。

## 1. 签名与选项

```ts
check(app: AppNode, opts?: { libs?: LoadedCatalog[] }): CheckResult
```

`libs` 是工程侧 FFI 扫描产物（dev/32，cli 从 `libs/*.json` 装载传入）；不传则只有内核五域。
内部先 `createCatalog(libs, app.dependencies)` 合并出**有效目录**，后续所有 FFI 成员解析都走它。

## 2. 六类诊断（check 主流程编号）

| # | 类别 | 检查内容 |
|---|------|----------|
| 1 | 悬空引用 | 遍历所有 TypeRef（含泛型参数），reference 必须 `resolve` 成功（`Object` 内建放行） |
| 2 | ForEach 容器 | 必须是可迭代 List：实体查询 / 已知变量 / 成员访问 / Call（宽松——明显非 List 才报） |
| 3 | Interface | 每个 endpoint 的 logicRef 必须可 resolve |
| 4 | 实体方法与查询链（最大块） | 见 §3；含 FFI 成员解析（4.6） |
| 5 | View | 组件类型 ∈ 内置集合或已注册 component；binding 的 logic/页面必须存在；**端点暴露**（绑定逻辑必须被 interface 暴露，实战教训）；G2 form 语义（derive 纯函数 + IO 禁令 + carryBy 可达） |
| 6 | 文件定位（M7） | 按诊断 path 反查顶层声明节点的 `file` 标，诊断落到分片 |

外部服务（4.5）：kind 合法；http 操作必须带 method + path。

## 3. 实体方法与查询链（checkEntityCalls）

- **静态**：`X.get(id)` 1 参；`X.where(...)` 条件字段存在 + 运算符白名单；`X.aggregate(sum(f))` 聚合白名单
- **链式**：`.orderBy/.page/.limit/.groupBy` 参数与字段校验（沿链递归找起点实体）
- **实例**：`.save()/.delete()` 无参；`list.add(x)`/`list.count` 接收者须是 List
- **外部服务**：`userService.getUser(id)` 按"接收者小驼峰 = service 短名"匹配，核对方法存在与参数个数
- **FFI 成员解析（4.6）**：receiver 类型已知（变量表 / 目录别名静态调用 / 链上 ret 传播 / `ns.Alias` 限定）才查目录；**未知类型放行**。目录外成员报 error 并附补录口径（`dsl bundle-jar`）

## 4. 依赖声明诊断（4.7，dev/32）

| 诊断 | 级别 | 条件 |
|------|------|------|
| D-dep-1 未声明依赖 | error | 用到有效目录中带坐标的产物类，坐标未出现在 `app.dependencies` |
| D-dep-2 声明无产物 | warning | 声明了依赖但 libs/ 无匹配 coordinate 产物（提示 bundle-jar） |
| D-dep-3 版本漂移 | warning | 声明版本 ≠ 产物 coordinate 版本 |
| D-dep-4 撞别名 | error | 同名类跨 jar / 与内核五域冲突（列出双方坐标 + 消解口径） |

D-dep-1 的"用了"来自 FFI 检查过程中收集的 `usedCoords`——**用即追踪**，声明与使用闭环。

## 5. 设计取舍：宽松放行

对"变量/成员表达式"**无法静态推导就不报错**，把误报率压到零、报错率留给确定场景。原因：

- 低代码 DSL 的用户是 LLM 和人，误报会直接污染修复闭环（LLM 会对误报做无意义修改）
- 完整类型推导/泛型统一是 M3 切面（dev/11 已有设计），不在当前阶段硬做

> 排查 typecheck 误报的口径：先确认是不是缺陷，**确认前不收紧**——避免破坏已有 demo。

## 6. 本包要记住的 3 件事

1. **有效目录 = 内核五域 ∪ 声明依赖的产物类**：typecheck 不知道 libs/ 文件系统，loader 在 cli/server 的 IO 层——core/typecheck 保持纯函数。
2. **诊断三要素**：nodePath（可寻址）+ 人话 message（LLM 可直接读）+ 补录口径（下一步动作可执行）。
3. **宽松是策略不是偷懒**：每条已实现的诊断都对应真实踩坑（端点暴露拦截就是前端白屏事故回流的产物）。

**动手练习**：把 fastjson-demo 的 `dependency` 声明删掉跑 `npm run dsl -- check examples/fastjson-demo/demo.tdsl`，观察 D-dep-1 的人话提示；再删 libs/fastjson2.json 看 D-dep-2。
