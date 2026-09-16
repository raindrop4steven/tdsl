# 46 · 需求分析 — ERP 门户看板与角色视角

> 状态：⏸ 待用户 Gate 确认（阶段一·需求分析）
> 日期：2026-09-16
> 关联：dev/39（芋道能力验证）、dev/45（动作状态化与链路联动）、dev/12（M2 查询语言：aggregate/groupBy）

## 1. 背景

芋道工程目前只有"列表 + 表单 + 抽屉"的业务页，缺少真实 ERP 的**门户/看板层**：

| 缺什么 | 现状 |
|--------|------|
| 统计指标 | `statistic` 元素存在但只接受 `value={表达式}`，**无法绑定查询**；聚合查询（M2 `aggregate/groupBy`）在 codegen-java 已支持，codegen-react 未接 |
| 布局与门face组件 | 无栅格（`row/col`）、无轮播（`carousel`）、无 `list`（antd List） |
| 角色视角 | 菜单只按 `@menu` 分组；无角色概念，所有人看到同一套菜单 |

用户诉求：**"ERP 应该有门户菜单页（一个或多个），不同人登录进来视角不同，展示轮播、列表组件、统计等。"**

## 2. 目标（本切面范围）

### F1 看板组件（语言 + codegen-react）

```tdsl
page erpDashboard {
  <row>                                                  // 栅格（span 24 制）
    <col span={6}><statistic title="采购订单数" dataSource={useQuery('countErpPurchaseOrder')} /></col>
    <col span={6}><statistic title="待审批入库" dataSource={useQuery('countErpPurchaseInPending')} /></col>
    <col span={6}><statistic title="库存总量" dataSource={useQuery('sumErpStockCount')} /></col>
    <col span={6}><statistic title="本月销售额" dataSource={useQuery('sumErpSaleAmount')} /></col>
  </row>
  <carousel autoplay>                                    // 轮播（公告/图示）
    <item title="新品上架" text="..." />
    <item title="九月促销" text="..." />
  </carousel>
  <row>
    <col span={12}>
      <list dataSource={useQuery('queryErpPurchaseInPending')}>   // List 列表组件（比 table 轻）
        <item field="no" title="单号" />
        <item field="inTime" title="入库时间" />
      </list>
    </col>
    <col span={12}> ... </col>
  </row>
}
```

- `statistic` 支持 `dataSource={useQuery('x')}`：取查询标量值渲染（自动解 `.data`）；
- 新增 `row` / `col(span)`：antd Grid 布局；
- 新增 `carousel(autoplay)` + `item(title,text)`：antd Carousel；
- 新增 `list(dataSource)` + `item(field,title)`：antd List（只读展示）。

### F2 聚合查询贯通（codegen-react）

- `Order.aggregate(sum(total))` / `.aggregate(count()).groupBy(x)` 已有语法与 java 端实现；
- 补齐 **react 端**：api 函数签名（标量/List<Map> 返回）、useQuery 渲染、statistic/list 取值；
- yudao 新增统计逻辑：采购订单数、待审批入库数、库存总量、本月销售额、线索数/转化数等（aggregate + where 条件）。

### F3 角色视角（菜单 + 路由过滤）

```tdsl
@role('采购员') @title('采购门户') @menu('门户') page purchasePortal { ... }
@role('老板')   @title('经营总览') @menu('门户') page bossDashboard  { ... }
```

- `@role('A,B')` 页面注解：声明该页面可见角色；**无注解 = 全部角色可见**（既有页面零改动）；
- 外壳（App.tsx）提供**角色切换器**（顶栏 Select，localStorage 记忆）：切换后菜单与路由按角色过滤；
- 明确是**演示级角色**（无鉴权/无后端数据权限），用于"不同人看到不同视角"的呈现。

### F4 yudao 门户样例

| 门户 | 角色 | 内容 |
|------|------|------|
| 经营总览 | 老板 | 指标卡（销售额/采购额/库存量/待审批）+ 轮播（公告）+ 待办列表 + 近期单据 |
| 采购门户 | 采购员 | 采购指标卡 + 待审批入库/退货列表 + 采购订单列表 |
| 销售门户 | 销售员 | 销售指标卡 + 待出库列表 + 销售订单列表 |
| 库存门户 | 仓管 | 库存/仓库指标卡 + 低库存列表 + 库存变动列表 |
| CRM 门户 | 销售员 | 线索/客户/商机指标卡 + 待跟进列表 + 逾期回款列表 |

## 3. 非目标（本轮不做）

- 真实登录/鉴权/后端数据权限/多租户（dev/39 已裁剪）；
- 图表库可视化（ECharts 可经 `dependency npm` 接入，但仪表盘图表另立切面）；
- 拖拽自定义布局、卡片下钻、告警订阅、导出报表；分页/排序已有（dev/45）。

## 4. 验收标准（阶段五依据）

| # | 场景 | 预期 |
|---|------|------|
| A1 | `statistic dataSource` 绑聚合查询 | 渲染真实数值（非 null/空） |
| A2 | `row/col` 栅格 | 指标卡按 span 排布（4 列/2 列） |
| A3 | `carousel` + `item` | 轮播自动切换，中文标题/文案显示 |
| A4 | `list` + `item` | 只读列表渲染（列名 + 值） |
| A5 | 角色切换 | 切「仓管」→ 菜单仅显示库存相关 + 门户；切「老板」→ 全部可见；刷新后记忆 |
| A6 | 既有页面 | 无 `@role` 注解 → 所有角色可见，页面生成结果不变 |
| R1 | 回归 | 全仓单测绿、`check-spec` 不回归、双端 build ✓ |

## 5. 受影响面

| 包 | 改动 |
|----|------|
| parser | `@role` 注解（页面级）；`row/col/carousel/item/list` 走通用元素/注解即可（预计零或极小改动） |
| core | 如需，ViewNode.annotations 已有承载 `role`（预计零改动） |
| typecheck | KNOWN_VIEW_TYPES 增加 `row/col/carousel/item/list`；`statistic.dataSource` 绑定校验（logic 存在 + 已 expose） |
| codegen-react | 组件映射（Grid/Carousel/List）、statistic 标量取值、菜单与路由按角色过滤、角色切换器（App.tsx + localStorage） |
| codegen-java | 期望零改动（聚合查询与 service 已支持；新增统计逻辑即普通 function） |
| examples/yudao | 5 个门户页面 + 统计逻辑 + `@role` 注解 + spec/check-spec 增加 `kind: dashboard` 映射 |

## 6. 风险

| 风险 | 对策 |
|------|------|
| 标量聚合返回类型在 react 端解包（`.data` 可能是数字/字符串） | statistic 渲染统一 `Number(data ?? 0)`；typecheck 宽松 |
| 角色过滤动摇既有 89 个页面 | 无注解=全角色，默认行为不变；角色只在有 `@role` 的页面生效 |
| 角色切换器引入"假的"权限感 | 文档与页面明确标注"演示级角色切换（无鉴权）" |
| `list`/`item` 与表格列语义重叠 | list 定位只读轻量展示，列渲染复用 `columnDefsOf` 的枚举/外键三态逻辑 |
| check-spec 五维不含"角色/看板" | 看板页按 `page` 计入（映射 `kind: dashboard`→page）；角色维度本轮不入 spec（记录理由） |
